# The Promise — 熄灯协议(操作手册)

> 我们对每一位用户的公开承诺:
> **"Whatever happens to us, your letter will reach you."**
> 你的信最坏的命运是「早到」,永远不会是「不到」。
>
> 这份文档是该承诺的**执行手册**。任何持有 Supabase 项目访问权的人,
> 按下面三步操作,即可在 Reunite 关闭前兑现承诺。请把本文档的存在
> 告知继任者/受托人(密码管理器 + 遗嘱级文件中注明)。

## 承诺为什么可信(三层保证)

1. **送达的信住在用户自己的邮箱里。** 每封到期的信,全文(文字 + 媒体链接)
   都会寄到用户的收件箱 —— 那是用户自己的地盘,不依赖我们的服务器存活。
2. **未送达的信有熄灯开关。** 服务端 `deliver` 函数内置 `DELIVER_FLUSH_ALL`
   开关:置为 `true` 后,下一次投递运行(每小时整点,pg_cron)会把**所有**
   未送达的信立刻全部送出,无视原定日期、对所有账号生效。
3. **运营成本近乎零。** 投递管道 = Postgres + 每小时一个 cron + Resend 邮件。
   免费/低价档即可维持多年;封存费预付了存储(宣言第 4 条)。

## 熄灯操作(三步,10 分钟)

**前提**:Supabase 项目 `vxvgcozpuerrjtoxwumi` 的访问权(CLI 已登录或 Dashboard)。

```bash
# 1. Turn on the flush switch — next hourly run delivers EVERYTHING undelivered.
supabase secrets set DELIVER_FLUSH_ALL=true --project-ref vxvgcozpuerrjtoxwumi

# 2. (Optional, faster) trigger delivery immediately instead of waiting for the hour:
curl -X POST "https://vxvgcozpuerrjtoxwumi.supabase.co/functions/v1/deliver" \
  -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" -d '{}'

# 3. Verify nothing is left, then it is safe to shut down:
#    (SQL Editor) select count(*) from letters where delivered_at is null;  -- must be 0
```

之后再关停订阅/删除项目。**顺序不可颠倒:先送信,后熄灯。**

## 给继任者的话

如果是你在读这份文档而创始人已无法亲自操作:谢谢你。上面三步执行完,
每一位把信托付给 Reunite 的人都会收到他们写给未来的话 —— 只是早了一点。
在投递邮件模板中可附一句说明(可选):
"Reunite is closing its doors. Your letter was due later — we're delivering it
early so it is never lost. It lives in this email now, yours forever."
