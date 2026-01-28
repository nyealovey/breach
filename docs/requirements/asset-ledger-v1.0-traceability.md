# 资产台账系统 v1.0（vCenter MVP）需求追溯矩阵（Traceability Matrix）

版本：v1.0  
日期：2026-01-27

## 文档简介

本文档用于把 v1.0（vCenter MVP）的“验收条款”与系统级需求（SRS）、API、数据模型、日志与 UI 页面做一一对应，避免实现与验收跑偏。

- 适用读者：产品、研发、测试、运维、评审人员。
- 使用方式：以 PRD 的 Acceptance Criteria 为入口，沿表格追溯到 SRS/设计文档；任何新增/变更的 v1.0 验收项必须同步更新本矩阵。
- 关联文档：
  - PRD（v1.0）：`docs/prds/asset-ledger-v1.0-prd.md`
  - SRS：`docs/requirements/asset-ledger-srs.md`
  - API 规范：`docs/design/asset-ledger-api-spec.md`
  - 概念数据模型：`docs/design/asset-ledger-data-model.md`
  - 日志规范：`docs/design/asset-ledger-logging-spec.md`
  - 错误码规范：`docs/design/asset-ledger-error-codes.md`
  - UI 规范：`docs/design/asset-ledger-ui-spec.md`

## 1) 功能验收追溯（v1.0）

> 说明：
>
> - “SRS 参考”以 FR/NFR 为主；若某条为 v1.0 的交付性要求但不适合放入 SRS，可标记为“PRD-only”。
> - “日志事件”以 `event_type` 为主（宽事件/域事件）；具体字段见日志规范。

| AC 编号 | PRD（v1.0）验收项                                                                                | SRS 参考                         | API 端点（示例）                                                                | 数据模型（核心实体）                                                | 日志事件（event_type）                                     | UI 页面/入口（v1.0）                 |
| ------- | ------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| AC-01   | 管理员初始化：首次启动可用 `ASSET_LEDGER_ADMIN_PASSWORD` 初始化默认管理员，并可修改密码          | FR-00（认证与会话）              | `POST /auth/login`、`PUT /auth/password`、`GET /auth/me`                        | `user`                                                              | `http.request`                                             | 登录页、修改密码                     |
| AC-02   | FR-01 Source 管理：可创建/编辑/启停/删除（软删除）Source；列表展示最近一次 Run 信息              | FR-01、NFR-02（安全）            | `GET/POST/PUT/DELETE /sources`、`PUT /sources/:id/credential`                   | `source`、`schedule_group`、`run`                                   | `http.request`                                             | Source 列表/详情、凭证更新、删除确认 |
| AC-03   | FR-02 Run：支持每日一次定时采集与手动触发；同 Source 单飞 + 触发抑制可审计                       | FR-01.A、FR-02、NFR-03（可靠性） | `POST /sources/:id/runs`、`GET /runs`、`GET /runs/:id`                          | `schedule_group`、`run`、`audit_event`                              | `schedule_group.triggered`、`run.finished`、`http.request` | 调度组管理、Run 列表/详情            |
| AC-04   | FR-03 插件化采集：支持 `healthcheck/detect/collect`；driver 选择可追溯；inventory 不完整必须失败 | FR-03、NFR-05（可观测性）        | `POST /sources/:id/runs`（mode=healthcheck/collect）                            | `run`、`source_record`、`relation_record`                           | `run.finished`                                             | Run 详情（driver/错误/统计）         |
| AC-05   | FR-04 资产统一视图：资产详情包含 unified fields（含来源证据/冲突）与关联来源明细（normalized）   | FR-04                            | `GET /assets`、`GET /assets/:uuid`、`GET /assets/:uuid/source-records`          | `asset`、`asset_source_link`、`source_record`、`asset_run_snapshot` | `http.request`                                             | Asset 列表/详情、来源明细            |
| AC-06   | FR-05 关系链：资产详情可展示 VM→Host→Cluster 关系链（允许缺边）                                  | FR-05                            | `GET /assets/:uuid/relations`                                                   | `relation`、`relation_record`                                       | `http.request`                                             | 关系链视图                           |
| AC-09   | raw 查看：管理员可查看某条 SourceRecord 的 raw payload，且访问动作可审计                          | FR-10、NFR-07                     | `GET /api/v1/source-records/:recordId/raw`                                      | `source_record`、`audit_event`                                      | `http.request`                                             | Asset 详情：来源明细 → 查看 raw      |
| AC-07   | Web UI：Source/Run/Asset/关系链均可用，权限仅 admin                                              | FR-00、2.2（权限验收）           | 同上                                                                            | 同上                                                                | `http.request`                                             | 全站导航与路由守卫                   |
| AC-08   | OpenAPI/Swagger：提供 OpenAPI JSON 与 Swagger UI，并覆盖 UI 所需 API                             | PRD-only（交付物）               | `GET /api/openapi.json`、`GET /api/docs`                                        | -                                                                   | `http.request`                                             | Swagger UI                           |

## 2) 质量与非功能验收追溯（v1.0）

| 项   | PRD/规范要求                                               | 主要落点                        | 验收方式（示例）                                                 |
| ---- | ---------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Q-01 | 代码质量：`lint/format/type-check` 通过                    | `package.json` scripts、CI      | `bun run lint && bun run format:check && bun run type-check`     |
| Q-02 | 日志：Web 请求宽事件 + 采集域事件；不泄漏 secrets          | 日志规范 + 实现                 | 抽样检查日志字段与脱敏规则（含 `*_excerpt` 截断）                |
| Q-03 | 错误码：稳定枚举 + retryable + UI 展示一致                 | 错误码规范 + API 规范 + UI 规范 | 随机挑 10 个失败场景核对 `error.code/category/retryable/message` |
| Q-04 | 数据校验：normalized/canonical schema 校验失败必须失败 Run | JSON Schema 文档 + Worker 落地  | 构造非法输出，确认 Run=Failed 且错误码一致                       |
