# 资产台账文档总览

> 推荐先读（唯一需求口径 / 验收依据）：`docs/requirements/asset-ledger-srs.md`

## 推荐阅读（需求口径）

- 需求规格说明书（SRS）：`docs/requirements/asset-ledger-srs.md`

## MVP（当前仓库实现对应，已归档）

- MVP 归档入口：`docs/mvp/index.md`
- vCenter MVP v1.0 计划：`docs/mvp/plans/2026-01-28-asset-ledger-vcenter-mvp.md`
- vCenter MVP v1.0 执行进度：`docs/mvp/plans/2026-01-28-asset-ledger-vcenter-mvp.progress.md`
- PRD（vCenter MVP 增量：凭据模块 + 调度组手动运行 v1.0）：`docs/mvp/prds/asset-ledger-vcenter-mvp-credentials-sg-manual-run-v1.0-prd.md`
- PRD（vCenter 插件：多版本 Driver + 关系/规格/电源状态 v1.1）：`docs/mvp/prds/asset-ledger-vcenter-plugin-versioned-drivers-v1.1-prd.md`
- PRD（vCenter Host（ESXi）版本/规格/型号/IP（SOAP）v1.3）：`docs/mvp/prds/asset-ledger-vcenter-host-esxi-version-v1.2-prd.md`
- PRD（资产列表盘点列展示 v1.0）：`docs/mvp/prds/asset-ledger-asset-list-inventory-columns-v1.0-prd.md`
- v1.0 需求追溯矩阵（Traceability）：`docs/mvp/requirements/asset-ledger-v1.0-traceability.md`
- 技术设计（vCenter MVP v1.0）：`docs/mvp/design/asset-ledger-vcenter-mvp-design.md`

## 后续里程碑（规划中）

- Roadmap（里程碑拆分与文档计划）：`docs/roadmap.md`
- 后续 PRD（新增/迭代需求）：`docs/prds/`
  - M1：vCenter Server 6.5 兼容性增强：`docs/prds/M1-asset-ledger-vcenter-6.5-compat-v1.0-prd.md`
  - M2：采集项优化（Datastore 明细：名称 + 容量）：`docs/prds/M2-asset-ledger-collector-optimizations-v1.0-prd.md`
  - M3：UI 优化（/assets）：`docs/prds/M3-asset-ledger-ui-optimizations-v1.0-prd.md`
  - M13：备份/监控覆盖采集（Veeam VBR + SolarWinds）：`docs/prds/M13-asset-ledger-backup-monitor-signals-v1.0-prd.md`
- 后续计划（工程任务拆分）：`docs/plans/`

## 参考文档（实现细节 / 规范）

- 本地开发与测试环境启动指南：`docs/runbooks/local-dev.md`
- API 规范：`docs/design/asset-ledger-api-spec.md`
- UI 交互规范：`docs/design/asset-ledger-ui-spec.md`
- 概念数据模型：`docs/design/asset-ledger-data-model.md`
- 采集插件参考：`docs/design/asset-ledger-collector-reference.md`
- 日志规范：`docs/design/asset-ledger-logging-spec.md`
- 错误码规范：`docs/design/asset-ledger-error-codes.md`
- normalized/canonical JSON Schema：`docs/design/asset-ledger-json-schema.md`

## 历史与计划（可忽略）

- vCenter MVP 相关 PRD/计划/追溯矩阵已归档在：`docs/mvp/`
