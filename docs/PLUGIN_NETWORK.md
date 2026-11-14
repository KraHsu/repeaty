# 插件网络与凭据

SDK 的 `network` 提供按学习库和插件启用实例授权的原生联网能力。来源连接器和其他学习插件使用同一接口；网络与凭据服务独立于具体插件，设备凭据不随学习库复制或分享。

## 授权与请求

固定服务可声明 manifest 的 `permissions.origins`。用户配置的服务声明 `permissions.network: true`，先调用 `network.authorize('https://example.org')`；宿主展示实际插件与完整 HTTPS origin，用户同意后才能访问。该授权只在当前库的本次启用实例内有效，切库或重新启用后重新确认。普通 `nativePlugin` 不能直接调用内部的 `network.authorize` 操作。

```ts
import { network } from '@repeaty/plugin-api'

const origin = new URL(serviceUrl).origin
await network.authorize(origin)
const response = await network.request(
  {
    url: `${origin}/api/materials`,
    method: 'GET',
    secret: { slot: 'source-account', headers: { Authorization: 'Bearer {{token}}' } },
  },
  signal,
)
```

密钥通过 `nativePlugin('secrets', …)` 写入设备私有存储，不能放入 `pluginData`。原生宿主将凭据绑定到保存时的服务 origin，在发送时插入指定头，不跟随重定向。公开凭据状态不回传密钥。

请求支持字符串、base64 二进制或 multipart，完整类型见 [network.d.ts](../packages/plugin-api/network.d.ts)。请求体最多 32 MiB，multipart 单项最多 25 MiB，响应最多 8 MiB；超限明确拒绝。

需要 XML 凭据插值的服务可使用 `secret.body: { template, encoding: 'xml' }`，不能同时传普通 body。宿主对凭据插值执行 XML 转义；构造模板时，其他用户内容也需 XML 转义，并将字面 `{`、`}` 编码为 `&#123;`、`&#125;`，避免被误认为凭据占位符。

## 生命周期与错误处理

网络请求绑定当前插件启用实例。AbortSignal、停用、卸载和切库会取消相关请求，更改凭据会停止使用旧凭据的请求；其他插件实例不受影响。迟到响应不能写入新的学习库。

取消等待或网络异常不表示远端写操作已经回滚。对有副作用的服务调用，应保留请求标识，并在重试前核对远端结果。模板、模型输出和材料内容均不能授予网络权限。

原生联网和设备凭据需要桌面版。插件仍是用户信任的 JavaScript；接口约束权限与资源生命周期，不构成任意恶意代码的强安全沙箱。
