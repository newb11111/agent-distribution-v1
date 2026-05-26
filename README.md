# Agent Distribution Production V1

这个版本是把之前 demo JSON 系统升级成可以接真实数据的 Production V1 骨架。

## 已改成真实的部分

- 数据从 `backend/data/store.json` 改成 PostgreSQL / Neon。
- Admin 密码使用 bcrypt hash，不再明文储存。
- Admin / Sales Adviser token 改成 JWT，有过期时间。
- TAC 改成数据库 OTP，支持过期、尝试次数限制、发送频率限制。
- TAC 不会在 production 回传给前端；development 才会显示 devTac 方便测试。
- Reward / 下单 / 分佣 / 年费续费 / 提款 reject refund 都走 database transaction。
- Sales Adviser 下单直接扣 Reward，不够就回 `INSUFFICIENT_REWARD`。
- 年费自动续费有 node-cron，每天自动检查。
- Reports 改成真正 XLSX 下载。
- Super Admin 调整 Reward 可以加或扣，且不能扣成负数。
- 操作写入 `audit_logs`。
- QR Code 改成本地前端生成，不再依赖外部 QR API。

## 保留 WhatsApp 手动充值逻辑

按照你的要求，Sales Adviser 充值不做 payment gateway：

1. Sales Adviser 去 WhatsApp 联系公司。
2. 公司人员在 WhatsApp 检查 receipt。
3. 确认后由 Super Admin 在系统里手动调整 Reward。
4. 系统会写入 `reward_ledger` 和 `audit_logs`。

## 本地运行

### 1. 安装

```bat
cd agent-distribution-production-v1
npm run install:all
```

### 2. Backend env

```bat
cd backend
copy .env.example .env
```

然后打开 `backend\.env`，填你的 Neon `DATABASE_URL`。

重要：上线前一定要改：

```env
JWT_SECRET=换成长随机字符串
OTP_PEPPER=换成长随机字符串
ADMIN_PASSWORD=换成强密码
SEED_DEMO_DATA=false
NODE_ENV=production
```

### 3. 初始化数据库

```bat
cd backend
npm run db:init
```

### 4. 开 backend

```bat
npm run dev
```

### 5. 开 frontend

```bat
cd ..\frontend
copy .env.example .env
npm run dev
```

## Email TAC 设置

你可以用 Resend：

```env
RESEND_API_KEY=re_xxx
EMAIL_FROM=no-reply@你的domain.com
NODE_ENV=production
```

或者 SMTP：

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=你的email
SMTP_PASS=你的app password
EMAIL_FROM=你的email
NODE_ENV=production
```

Development mode 没设置 Email 时，backend console 会印出 TAC，而且 API 会回传 `devTac` 方便测试。
Production mode 不会回传 `devTac`。

## 默认账号

如果 `SEED_DEMO_DATA=true`：

```txt
Super Admin:
admin / admin123

Leader:
ops / ops123

Fulfillment:
packing / pack123

Demo Sales Adviser:
agent@example.com 通过 TAC 登录
```

真正上线时建议：

```env
SEED_DEMO_DATA=false
```

然后只保留你自己的 Super Admin。

## 数据库主要表

- `admin_users`
- `sales_advisers`
- `otp_codes`
- `products`
- `commission_rules`
- `orders`
- `payment_proofs`
- `reward_ledger`
- `commission_ledger`
- `company_ledger`
- `withdrawals`
- `audit_logs`
- `system_settings`

## 重要上线检查

上线前一定要确认：

1. `DATABASE_URL` 是 Neon production database。
2. `NODE_ENV=production`。
3. `JWT_SECRET` 和 `OTP_PEPPER` 已换掉。
4. `ADMIN_PASSWORD` 已换成强密码。
5. `FRONTEND_URL` 是你的真实 domain，例如 `https://yourdomain.com`。
6. Email TAC 已真的能发送。
7. `SEED_DEMO_DATA=false`，不要留下 demo 账号。
8. 先用小金额测试：Super Admin 加 Reward → Sales Adviser 下单 → Reward 扣款 → 分佣 → 出货 → report 下载。

## 现在还没做 payment gateway

这是刻意保留的，因为你说充值流程要走 WhatsApp + 公司人工确认 receipt + Super Admin 手动加 Reward。
