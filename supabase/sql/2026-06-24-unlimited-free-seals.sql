-- 2026-06-24 — Words 永久免费、不限次数:删掉「每个用户只能一封免费信」的唯一索引。
--
-- 背景:定价策略改为「纯文字胶囊(无媒体)永久免费、不限次数」。
-- 原 letters_one_free_per_owner 是一个部分唯一索引(只对 seal_tier='free' 的行生效),
-- 在数据库层把每个用户限制成「一辈子只能一封免费信」,与新策略冲突,故删除。
--
-- 不受影响:媒体档(seal_tier in 'photos'|'video')仍走付费 + RevenueCat 验证 +
-- used_transactions 防重放双花;letters 表的 RLS(insert-only)与 lock-insert 触发器照旧。
--
-- 部署顺序:先跑这条迁移(删索引)→ 再部署新的 seal-letter 函数。
-- 否则旧函数遇到第二封免费信会撞唯一索引(23505)。新函数已不再依赖该索引。

drop index if exists letters_one_free_per_owner;
