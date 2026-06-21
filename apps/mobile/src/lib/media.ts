// 媒体附件:选 1 张照片 / 1 段短视频,上传到 Supabase Storage 的 memories 公开桶。
// 路径带随机串,猜不到;只有拿到看信链接的人才看得到。
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { supabase } from './supabase';

export type PickedMedia = { uri: string; kind: 'photo' | 'video' };

// 一封信最多放 4 张照片(视频仍只允许 1 段)。
export const MAX_PHOTOS = 4;

// 体积上限:我们把整个文件读进内存再上传,太大手机会崩溃,所以先拦住。
const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB

// 太大就提示并拒绝;拿不到大小(undefined)就放行。
function tooBig(size: number | undefined, max: number, label: string): boolean {
  if (typeof size === 'number' && size > max) {
    Alert.alert(`${label} too large`, `Please choose one under ${Math.round(max / 1024 / 1024)} MB.`);
    return true;
  }
  return false;
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

// 选 1 段视频,最长 30 秒(PRD 限制)。
export async function pickVideo(): Promise<PickedMedia | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: true,
    videoMaxDuration: 30,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  if (tooBig(res.assets[0].fileSize, MAX_VIDEO_BYTES, 'Video')) return null;
  return { uri: res.assets[0].uri, kind: 'video' };
}

// 生成一个猜不到的文件夹名(媒体路径用)。
export function randomFolder(): string {
  return 'm' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// 把本地文件读出来 → 上传到 memories 桶 → 返回公开 URL(失败返回 null)。
// index = 第几张照片(多张照片用不同文件名,避免互相覆盖);视频忽略它。
export async function uploadMedia(media: PickedMedia, folder: string, index: number = 0): Promise<string | null> {
  try {
    const isPhoto = media.kind === 'photo';
    const path = isPhoto ? `${folder}/photo-${index}.jpg` : `${folder}/video.mp4`;
    const contentType = isPhoto ? 'image/jpeg' : 'video/mp4';
    // 读成 base64 再解码成字节(Expo Go 里最稳的上传方式,不依赖原生模块)。
    const base64 = await FileSystem.readAsStringAsync(media.uri, { encoding: 'base64' });
    const { error } = await supabase.storage
      .from('memories')
      .upload(path, decode(base64), { contentType, upsert: true });
    if (error) {
      console.log('媒体上传失败:', error.message);
      return null;
    }
    return supabase.storage.from('memories').getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.log('媒体上传异常:', e);
    return null;
  }
}
