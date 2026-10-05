# plan-usage-app

macOS 菜单栏应用，实时监控 AI 服务商的套餐额度与 Token 用量。基于 Electron + React + TypeScript 构建。

## 功能

- **菜单栏弹窗概览**：点击托盘图标即可查看各服务商的剩余 Credits / 用量进度
- **按天用量趋势图**：独立详情窗口展示 Token 消耗的每日趋势（recharts）
- **多服务商支持**：
  - 阿里云百炼：Token Plan 团队版席位 Credits + 模型账单消费统计
  - 火山方舟：套餐用量详情（按天统计 Tokens）
- **本地加密存储**：AccessKey 等密钥仅保存在本地并加密，不上传任何服务器
- **插件式架构**：新增服务商只需实现 `ProviderAdapter` 接口并注册到 `src/main/providers/index.ts`，UI 自动适配

## 开发

```bash
npm install
npm run dev        # 开发模式
npm run build      # 构建
npm run typecheck  # 类型检查
```

## 项目结构

```
src/
  main/          # Electron 主进程（托盘、窗口、IPC、Provider 适配器）
    providers/   # 服务商适配器（阿里云百炼、火山方舟）及签名工具
  preload/       # 上下文桥接
  renderer/      # React 渲染进程（概览 / 详情 / 设置）
  shared/        # 主进程与渲染进程共享的类型契约
docs/            # 各服务商 API 文档
```

## License

MIT
