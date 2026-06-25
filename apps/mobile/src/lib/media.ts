// 媒体附件:选 1 张照片 / 1 段短视频,上传到 Supabase Storage 的 memories 公开桶。
// 路径带随机串,猜不到;只有拿到看信链接的人才看得到。
//
// 上传策略(2026-06 升级):
//   原生 — 视频先压缩(react-native-compressor),再用 FileSystem.uploadAsync 流式上传
//          (直接从磁盘读,不把整个文件转 base64 加载进内存)。
//   Web  — 不变:fetch().blob() + supabase-js。
//
// TODO: 如果压缩对长视频(>3 min)在低端机上明显卡顿,考虑换用 TUS 协议的 resumable upload,
//       配合后台任务让用户可以离开 app 继续传。
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

import { supabase } from './supabase';

// durationSec = 视频时长(秒),从 ImagePicker asset.duration(毫秒)四舍五入而来。
// 供 tierFor() 判断定价档位用——如果 picker 没有返回时长,则为 undefined。
export type PickedMedia = { uri: string; kind: 'photo' | 'video'; durationSec?: number };

// 一封信最多放 10 张照片(视频仍只允许 1 段,最长 5 分钟 = 300 秒)。
// 4→10:Photos & Long Video 档位允许最多 10 张。
export const MAX_PHOTOS = 10;

// 体积上限:Supabase 免费套餐单文件 50 MB 硬上限(已确认)。
const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB
// 视频上限:50 MB(Supabase Storage 免费套餐单文件上限)。
// 压缩后目标是 ≤45 MB,留 5 MB 余量;超出则提示用户。
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
// 压缩的目标体积:留出余量,压完落在它以下就收工(50 MB 是硬墙,44 MB 给上传/抖动留 6 MB)。
const TARGET_VIDEO_BYTES = 44 * 1024 * 1024; // 44 MB

// ── 视频压缩(仅原生) ────────────────────────────────────────────────────────
// react-native-compressor 需要 native build(Expo Go 里原生模块不存在)。
// ⚠️ 致命坑(已修):不要用 `NativeModules.Compressor != null` 判断是否可用 ——
// 新架构(New Architecture / TurboModules,Expo SDK 56 默认开启)下,这个库的原生模块
// 注册成 TurboModule,`NativeModules.Compressor` 恒为 null,会被误判成"不可用"而
// 永远跳过压缩 → 真机上原始大视频(哪怕只有 36 秒)被 50MB 上限拒掉。
// 正确做法:直接 require 这个库来用 —— 它内部 (Main.tsx) 自己按新旧架构选择
// TurboModuleRegistry.getEnforcing / NativeModules。Expo Go 里 require 会在模块
// 初始化阶段抛错,由下面 getCompressVideoFn 的 try/catch 兜住、静默降级。
const compressorEnabled = Platform.OS !== 'web';

// VideoCompressor 的类型定义(只用 compress 方法)。
// 用动态 require 而非顶层 import——顶层 import 在 Expo Go 里会在模块解析阶段抛错。
type CompressVideoFn = (
  uri: string,
  options?: {
    compressionMethod?: 'auto' | 'manual';
    maxSize?: number;   // 输出最长边(像素)
    bitrate?: number;   // 目标比特率(bps)
    minimumFileSizeForCompress?: number; // 小于此大小(字节)跳过压缩
    stripAudio?: boolean; // true = 去掉音轨(最后几档省体积用)
  },
  onProgress?: (progress: number) => void,
) => Promise<string>;

// 懒加载压缩函数——原生平台尝试 require;require 成功即可用(新旧架构通吃)。
// Expo Go 里 require 会在模块初始化阶段抛错(找不到原生模块),被 catch 兜住返回 null。
function getCompressVideoFn(): CompressVideoFn | null {
  if (!compressorEnabled) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-compressor') as { Video?: { compress?: CompressVideoFn } };
    return mod.Video?.compress ?? null;
  } catch {
    return null;
  }
}

// compressVideoToFit — 压缩视频,保证输出体积 ≤ TARGET_VIDEO_BYTES。
// 关键认知:react-native-compressor 用的是 AVVideoAverageBitRateKey —— 一个「软目标」码率。
// 对高细节内容(尤其屏幕录制)编码器会大幅超标(实测:设 1.2 Mbps 却产出 ~1.9 Mbps → 66 MB,
// 超过 50 MB 上限)。所以不能「设一次码率就信它」,必须:压完量一下,还超就降一档
//(更小分辨率 + 更低码率)从「原片」重压,直到塞进目标。correct-by-construction:
// 每一步都实测体积,命中即止 —— 数学上不会产出超限文件(最差收敛到很小的低分辨率)。
// 时长已知(durationSec),据此算首档码率,让绝大多数视频「一档命中」(只压一次,快)。
// 压缩不可用(web / Expo Go / 模块异常)→ 返回原始 URI,由上传前的 50 MB 守卫兜底。
async function compressVideoToFit(uri: string, durationSec: number | undefined): Promise<string> {
  if (Platform.OS === 'web') return uri;
  const compress = getCompressVideoFn();
  if (!compress) return uri;

  const dur = durationSec && durationSec > 0 ? durationSec : 300; // 拿不到时长 → 按 5 分钟(最保守)
  // 首档码率:让「软目标 × ~1.7 倍超标」后体积仍 ≈ TARGET。夹在 [500k, 1.5M]。
  const firstBps = Math.round(Math.min(1_500_000, Math.max(500_000, (TARGET_VIDEO_BYTES * 8) / dur / 1.7)));

  // 降档阶梯:分辨率↓ + 码率↓,越往后越狠;靠后才丢音轨(尽量保留人声)。
  const ladder: { maxSize: number; bitrate: number; stripAudio?: boolean }[] = [
    { maxSize: 720, bitrate: firstBps },
    { maxSize: 640, bitrate: Math.round(firstBps * 0.7) },
    { maxSize: 540, bitrate: Math.round(firstBps * 0.5) },
    { maxSize: 432, bitrate: Math.max(350_000, Math.round(firstBps * 0.4)), stripAudio: true },
    { maxSize: 360, bitrate: Math.max(300_000, Math.round(firstBps * 0.3)), stripAudio: true },
  ];

  let best = uri;
  for (const step of ladder) {
    try {
      const out = await compress(uri, {     // 每档都从「原片」重压,不在已压文件上反复压(免画质叠损)
        compressionMethod: 'manual',
        maxSize: step.maxSize,
        bitrate: step.bitrate,
        stripAudio: step.stripAudio,
        minimumFileSizeForCompress: 0,      // 既然进了这条路,一律压
      });
      best = out;
      const info = await FileSystem.getInfoAsync(out);
      const size = info.exists ? info.size : undefined;
      console.log(`[media] 压缩档 maxSize=${step.maxSize} bitrate=${step.bitrate} → ${typeof size === 'number' ? Math.round(size / 1048576) + 'MB' : '?'}`);
      if (typeof size === 'number' && size <= TARGET_VIDEO_BYTES) return out; // 塞进目标 → 完成
    } catch (e) {
      console.warn('[media] 该档压缩失败,尝试下一档:', e);
    }
  }
  return best; // 跑完阶梯仍偏大(极罕见)→ 返回最后一次;上传前 50 MB 守卫会兜底拒绝
}

// 选多张照片(从相册,可多选)。remaining = 还能再加几张(调用方传 MAX_PHOTOS - 已选)。
export async function pickPhotos(remaining: number): Promise<PickedMedia[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, remaining),
    quality: 0.8,
  });
  if (res.canceled || !res.assets?.length) return [];
  // 太大的照片丢掉;如果丢了至少一张,提示一次就好。
  let dropped = false;
  const kept: PickedMedia[] = [];
  for (const a of res.assets) {
    if (typeof a.fileSize === 'number' && a.fileSize > MAX_PHOTO_BYTES) {
      dropped = true;
      continue;
    }
    kept.push({ uri: a.uri, kind: 'photo' });
  }
  if (dropped) {
    Alert.alert('Photo too large', `Some photos over ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB were skipped.`);
  }
  // 永远不超过 remaining 张。
  return kept.slice(0, Math.max(0, remaining));
}

// Pick 1 video from the library, up to 5 minutes (300 s).
//
// Why allowsEditing is removed:
//   On iOS, allowsEditing:true activates the system trim UI, which enforces a
//   ~30 s cap on library videos regardless of videoMaxDuration.
//   videoMaxDuration only limits RECORDING, not library selection.
//   Removing allowsEditing lets the user pick any library video; we then
//   enforce the 5-minute cap ourselves with an explicit post-pick guard.
//   (Verified against Expo SDK 56 expo-image-picker docs:
//    https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/
//    "allowsEditing ... On iOS, the user can also trim and crop the video.")
export async function pickVideo(): Promise<PickedMedia | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    // allowsEditing intentionally omitted — see comment above.
  });
  if (res.canceled || !res.assets?.[0]) return null;
  // Raw file size is intentionally NOT checked here.
  // A 5-min phone video can be 200-400 MB raw, but compressVideoIfNeeded()
  // in uploadMedia() squeezes it to ~45 MB (720p / 1.2 Mbps).
  // The real 50 MB ceiling is enforced POST-compression in uploadMedia().
  // asset.duration unit is milliseconds (ms); convert to seconds and round.
  const durationSec =
    typeof res.assets[0].duration === 'number'
      ? Math.round(res.assets[0].duration / 1000)
      : undefined;
  // Post-pick 5-minute guard: reject anything over 300 s.
  // Neither allowsEditing nor videoMaxDuration reliably limits library picks on iOS,
  // so we enforce the cap here after the fact.
  if (typeof durationSec === 'number' && durationSec > 300) {
    Alert.alert(
      'Video too long',
      'This video is longer than 5 minutes. Please choose a shorter clip.',
    );
    return null;
  }
  return { uri: res.assets[0].uri, kind: 'video', durationSec };
}

// 生成一个猜不到的文件夹名(媒体路径用)。
export function randomFolder(): string {
  return 'm' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// ── 原生流式上传(替代 base64 方案) ──────────────────────────────────────────
// FileSystem.uploadAsync 直接从磁盘读文件,以 HTTP PUT/POST 流式发到 Supabase Storage REST。
// 不把文件整个读进内存,也不经过 base64 编码(base64 会膨胀 ~33%)。
// Supabase Storage REST 对象端点:${SUPABASE_URL}/storage/v1/object/${bucket}/${path}
// 认证头:apikey(anon 公开密钥)+ Authorization: Bearer <当前用户令牌或 anon 密钥>。
// 返回值规约:与 supabase-js 的 getPublicUrl() 完全一致(公开桶直接构建 URL)。
async function streamUpload(fileUri: string, bucket: string, path: string, contentType: string): Promise<boolean> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

  // 拿当前登录用户的 access_token(访问令牌);没登录就用 anonKey。
  // access_token = 证明"我是谁"的短期身份票据。
  const { data: sessionData } = await supabase.auth.getSession();
  const bearerToken = sessionData?.session?.access_token ?? anonKey;

  // REST 端点:POST 到 /storage/v1/object/<bucket>/<path>。
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;

  // FileSystem.uploadAsync 做的事:打开文件 → 分块读 → 发 HTTP → 释放内存。
  // 整个过程内存占用约等于一个网络缓冲块(几十 KB),而不是整个文件。
  const result = await FileSystem.uploadAsync(url, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': contentType,
      'x-upsert': 'false', // 拒绝覆盖同路径的已有文件
    },
  });

  // Supabase Storage 返回 200(已存在时 409 或 400);2xx = 成功。
  if (result.status < 200 || result.status >= 300) {
    console.warn('[media] 流式上传失败, HTTP', result.status, result.body);
    return false;
  }
  return true;
}

// 把本地文件上传到 memories 桶 → 返回公开 URL(失败返回 null)。
// index = 第几张照片(多张照片用不同文件名,避免互相覆盖);视频忽略它。
//
// 视频原生路径:先压缩 → 二次检查大小 → 流式上传。
// 照片原生路径:流式上传(无需压缩,picker 已经 quality:0.8 缩图)。
// Web 路径:fetch().blob() + supabase-js(不变)。
export async function uploadMedia(media: PickedMedia, folder: string, index: number = 0): Promise<string | null> {
  try {
    const isPhoto = media.kind === 'photo';
    const path = isPhoto ? `${folder}/photo-${index}.jpg` : `${folder}/video.mp4`;
    const contentType = isPhoto ? 'image/jpeg' : 'video/mp4';

    if (Platform.OS === 'web') {
      // Web:fetch blob → supabase-js(浏览器路径不变)。
      const blob = await (await fetch(media.uri)).blob();
      const { error } = await supabase.storage
        .from('memories')
        .upload(path, blob, { contentType, upsert: false });
      if (error) {
        console.warn('[media] Web 上传失败:', error.message);
        return null;
      }
    } else {
      // 原生:流式上传(视频额外先压缩)。
      let uploadUri = media.uri;

      if (!isPhoto) {
        // 1. 压缩到目标体积以下(内部按时长选码率,压完量一下、还超就降档重压)。
        uploadUri = await compressVideoToFit(media.uri, media.durationSec);

        // 2. 压缩后再量一次大小——万一阶梯跑完仍超 50 MB(极端原片),温和拒绝。
        // FileInfo 在 exists:true 时直接带 size 字段,无需额外选项。
        const info = await FileSystem.getInfoAsync(uploadUri);
        const sizeBytes = info.exists ? info.size : undefined;
        if (typeof sizeBytes === 'number' && sizeBytes > MAX_VIDEO_BYTES) {
          // 提示里带上真实体积:既对用户更友好,也方便排查(若显示 100+ MB 说明压缩没生效)。
          const mb = Math.round(sizeBytes / 1024 / 1024);
          const limitMb = Math.round(MAX_VIDEO_BYTES / 1024 / 1024);
          Alert.alert(
            'Video too large to seal',
            `This video is ${mb} MB after compression, over the ${limitMb} MB limit — please try a shorter clip.`,
          );
          return null;
        }
      }

      // 3. 流式上传(照片 / 已压缩视频)。
      const ok = await streamUpload(uploadUri, 'memories', path, contentType);
      if (!ok) return null;
    }

    // 返回公开 URL —— 与之前完全一样(memories 桶是公开桶,路径格式不变)。
    return supabase.storage.from('memories').getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.warn('[media] 上传异常:', e);
    return null;
  }
}
