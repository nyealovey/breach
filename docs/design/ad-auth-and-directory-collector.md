# AD 认证与目录采集设计（多域）

版本：v1.0  
日期：2026-02-07

## 1. 背景与目标

本设计将 Active Directory（LDAP）能力拆分为两条独立链路：

1. **认证链路**：用于登录验密（UPN 登录）。
2. **采集链路**：用于采集域与用户目录信息。

两条链路共享 AD Source/Credential 配置，但执行上解耦，可独立启停。

## 2. 核心策略

- 登录模式：保留本地 `admin` 兜底。
- 准入策略：**白名单**（必须先创建用户，才允许 LDAP 登录）。
- 登录标识：仅支持 UPN（如 `user@example.com`）。
- 角色策略：系统内手工设置 `admin/user`，不做 LDAP 组自动映射。
- 改密策略：LDAP 用户不可在系统内改密，仅本地用户可改密。

## 3. AD Source 配置

`sourceType=activedirectory` 时，`config` 关键字段：

- `purpose`: `auth_collect | collect_only | auth_only`
- `endpoint` / `server_url`: LDAP 服务地址（如 `ldaps://dc01.example.com:636`）
- `base_dn`: 搜索根（如 `DC=example,DC=com`）
- `upn_suffixes`: UPN 后缀数组（认证用途必填）
- `tls_verify`: 是否校验证书（默认 `true`）
- `timeout_ms`: 超时（默认 60000）
- `user_filter`: 可选过滤表达式

### 3.1 多域路由规则

登录时按 UPN 后缀匹配 `upn_suffixes`：

- 仅匹配 `purpose in (auth_collect, auth_only)` 的 Source
- **最长后缀优先**
- 认证用途 Source 的后缀不允许冲突（保存时校验）

## 4. 用户与认证数据模型

`User` 新增字段：

- `authType`: `local | ldap`
- `externalAuthId`: LDAP 用户 UPN（小写，唯一）
- `enabled`: 用户开关
- `passwordHash`: 本地用户必填，LDAP 用户可为空

登录流程：

1. 本地 `admin` 走本地密码校验；
2. 非本地账号必须先命中 `User(authType=ldap, externalAuthId=UPN, enabled=true)`；
3. 命中后才进行 LDAP 验密；
4. 验密成功后按本地角色签发 session。

## 5. 目录采集数据模型

新增目录模型（不并入 VM/Host/Cluster 资产模型）：

- `DirectoryDomain`
- `DirectoryUser`
- `DirectoryUserSnapshot`

采集 `collect` 成功后写入以上模型，供目录 API 查询。

## 6. 新增/调整接口

### 6.1 认证

- `POST /api/v1/auth/login`：支持本地 + LDAP 白名单登录
- `PUT /api/v1/auth/password`：仅本地用户可改密
  - LDAP 用户返回：`403 AUTH_PASSWORD_CHANGE_NOT_ALLOWED`
- `GET /api/v1/auth/me`：返回 `authType` 与 `enabled`

### 6.2 用户管理

- `GET /api/v1/users`
- `POST /api/v1/users`
- `PATCH /api/v1/users/:id/role`
- `PATCH /api/v1/users/:id/enabled`
- `DELETE /api/v1/users/:id`：软删除用户（释放 UPN/username 唯一约束；清理 session；`admin` 受保护不可删）

### 6.3 目录查询

- `GET /api/v1/directory/domains`
- `GET /api/v1/directory/users`

## 7. 页面改动

- 新增 `/users`：用户管理（列表仅展示）。
  - 新增/编辑：统一使用模态框（create/edit 同一弹窗），仅支持创建 LDAP 白名单用户（UPN 登录）。
  - 列表：状态用 Switch 展示（只读），角色/状态修改必须进入“编辑”弹窗。
  - 视图过滤：默认仅展示 LDAP 用户；提供「显示系统账号」开关用于展示本地账号（如 `admin`）。
  - 删除：提供“删除”按钮（软删除）。
  - `admin`：系统保留账号，只读保护（不可编辑/不可删除）。
- 新增 `/profile`：账号设置页。
  - LDAP 用户显示“请在 AD 侧修改密码”，并禁用改密按钮。
- 顶部导航新增“用户”“账号”入口。

## 8. 兼容性与回滚

- 认证与采集解耦，任一链路故障不影响另一链路。
- 本地 `admin` 始终可作为 LDAP 故障兜底入口。
- `purpose=auth_only` 的 AD Source 禁止触发 collect。

## 9. OpenAPI 覆盖范围（2026-02-07）

为保证接口可见性与联调一致性，OpenAPI 文档已补齐以下端点：

- 认证：`/api/v1/auth/login`、`/api/v1/auth/me`、`/api/v1/auth/password`
- 用户管理：`/api/v1/users`、`/api/v1/users/{id}/role`、`/api/v1/users/{id}/enabled`
- 用户删除：`/api/v1/users/{id}`
- 目录查询：`/api/v1/directory/domains`、`/api/v1/directory/users`
