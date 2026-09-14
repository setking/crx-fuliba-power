---
name: ui-style
description: 维护 popup / sidepanel 视觉样式（颜色语义、字体栈、scoped 样式边界）。当新增组件、调整颜色 / 字体、改 style.css 时使用。
when_to_use: 新增 popup / sidepanel 组件；调整颜色语义；改字体栈；改 style.css；给结果行 / 状态条加色
when_not_to_use: 改业务逻辑；改消息协议；改白名单
---

# ui-style — UI 视觉约定

## 字体栈

```css
font-family: ui-sans-serif, system-ui, sans-serif;
```

不要引入 web font（增加 dist 体积 + 网络依赖）。

## 颜色语义

| 语义 | 背景 | 文字 |
|---|---|---|
| 成功 / 已登录 | `#d1fae5` | `#065f46` |
| 警示 / 未登录 | `#fee2e2` | `#991b1b` |
| 错误条 | `#fef3c7` | `#92400e` |
| 主色（按钮 / 链接） | `#3b82f6` | hover `#2563eb` |
| 签到按钮 | `#10b981` | hover `#059669` |

> 当前约定，可在 UI 层适度替换；保持语义一致即可（成功=绿、警示=红、错误=黄）。

## 样式边界

- 每个页面（popup / sidepanel）有自己的 `style.css`
- 组件内部用 `<style scoped>`
- **不要**给 `<style scoped>` 之外的全局样式加新规则，必要时改对应 `style.css`
- 注入到论坛页面的 DOM 用 **Shadow DOM** 隔离（详见 `whatslink-preview` skill）

## 命名建议

- 状态类名用语义前缀：`is-success` / `is-warning` / `is-error` / `is-primary` / `is-checkin`
- 不用 magic 颜色字符串满地散落 —— 把语义色绑在 `style.css` 根类上，组件只引类名