# dsh 蓝鲸余额桌宠

提供原版 DeepSeek 蓝鲸和社区鲸鱼娘两种形象。鲸鱼娘为透明背景的 Q 版蓝发女仆，使用六种情景各两组、每组四帧的独立绘制动画（共 48 帧）；原版蓝鲸的浮动和气泡动画继续保留。适用于 macOS DeepSeek Harness Desktop 和 DSH Web。

- 单击蓝鲸：展开余额卡片，并重新请求官方 `/user/balance` 接口。
- 卡片显示总可用余额、充值余额、赠送余额，保留至多四位小数；不同币种分别展示。
- 后台每 15 秒刷新；隐藏页面暂停轮询，回到页面时重新查询。
- 按住蓝鲸拖动，位置自动保存；拖动不会误触查询。
- 点击卡片右上角 × 或按 Escape 关闭。支持键盘聚焦、Enter 和减少动态效果设置。
- 点击任一桌宠打开卡片，在底部「桌宠形象」中选择「蓝鲸原版」或「鲸鱼娘 · 抱饭碗」，选择立即生效并自动保存。首次升级默认鲸鱼娘。
- 失败时保留上一次结果并明确标注刷新失败与查询时间。

API Key 每次通过宿主 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 读取，与 dsh 官方模型共用已有配置。客户端和本插件文件不保存密钥。密钥仅发送至 `https://api.deepseek.com/user/balance`，拒绝重定向；不调用聊天模型。

## 安装

先获取本仓库：`git clone`，或页面右上角 **Code → Download ZIP** 解压；把插件目录放到一个固定位置，例如 `~/dsh-plugins/dsh-blue-whale-balance`。

### 桌面版（DeepSeek Harness Desktop）

桌面版由 Electron 管理配置。为 desktop profile 添加本地包依赖和插件行后重启 dsh（修改前建议备份这两个文件）：

1. `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 增加一行（路径换成你的实际位置）：

   ```json
   "dsh-blue-whale-balance": "link:/absolute/path/to/dsh-blue-whale-balance"
   ```

2. `~/.dsh/profiles/desktop/cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: blue-whale-balance
         name: dsh-blue-whale-balance
         config:
           requestTimeoutMs: 10000
   ```

3. 重启 DeepSeek Harness Desktop 生效；若未出现，检查 dsh 插件加载日志。桌宠位于 dsh 窗口悬浮层，跟随 dsh 界面显示。

### Web 版

对于 Web profile，可使用官方 CLI：

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-blue-whale-balance
```

可在 profile 的补丁中设置网络超时时间：

```yaml
- update:
    - id: blue-whale-balance
      config:
        requestTimeoutMs: 10000
```

## 测试

```sh
npm test
```

测试使用假密钥和模拟网络，检查余额精度、多币种、每次查询的新鲜度、重叠请求合并、失败重试、错误不泄露密钥、外部来源拒绝与插件卸载清理。

## 参考

- 官方接口：https://api-docs.deepseek.com/api/get-user-balance/
- 官方插件宿主：https://github.com/deepseek-ai/deepseek-harness
- 鲸鱼图案来源：https://github.com/FenyxHuang/dsh-desktop-pet
- 参考版本：`12edce05da4d83ebd4bae241f07aad364f0f54eb`

鲸鱼娘形象资料：https://github.com/Neko3000/deepseek-whalechan 。新素材使用内置 image_gen 工具，按社区常见视觉特征重新生成，未复制下载的参考图；静态形象提示词见 ASSET-PROMPT.md，六种逐帧动画的完整提示词见 FRAME-PROMPTS.json。

本插件独立实现查询与界面逻辑。DeepSeek 名称和蓝鲸图案属于 DeepSeek；鲸鱼娘为社区二创，非官方吉祥物。

## v1.3.0 逐帧动画

| 情景 | 动作 A | 动作 B | 每帧时长 |
|---|---|---|---|
| 待机 | 抱碗眨眼、尾巴轻摆 | 用勺子舀饭吃饭 | 320 ms |
| 工作中 | 在平板上书写 | 思考、灵感动作 | 260 ms |
| 完成待查看 | 挥手提醒 | 竖拇指庆祝 | 260 ms |
| 余额不足 | 抱着仅剩几粒米的碗哀求 | 双手递出空碗讨饭 | 400 ms |
| 被拖动 | 伸手保持平衡 | 抱碗蜷腿 | 220 ms |
| 被点击 | 惊讶后微笑 | 贴脸招手 | 240 ms |

每张 PNG 是固定四列两行的透明精灵图。播放器逐帧移动背景裁切窗口，每组循环随机 2–4 次，再在完整循环边界换组；初始动作组随机。鲸鱼娘关闭整图位移的 CSS 动画，手部、眼睛、脸和尾巴由重新绘制的帧变化驱动。原版蓝鲸保留原有动画。

工作状态来自宿主真实 sessionStatus；完成未读状态保持至查看；欠费由余额返回值触发；拖动和点击优先显示对应交互动作。预览动作在 6.5 秒后恢复真实状态。减少动态效果时停止逐帧计时；隐藏页面暂停播放，卸载清理计时器和监听器。

打开同目录 preview.html 可同时检查十二组动作，支持暂停、逐帧和变速。

## v1.4.0 主题、账目与提醒

- 卡片增加「当前 / 历史 / 设置」。官方可用余额仍直接来自官方接口；本会话估算未接入可核验的逐轮计费数据，明确显示「未知」。
- 后端返回不含原始密钥的 SHA-256 截断指纹。每个密钥独立记录观测起点、余额下降与增加；同一账户的不同密钥也分别记录，不声称该指纹能识别真实账户。币种分别统计。
- 余额增加单独展示，不当成负消费；充值与调用发生在同一采样间隔时，实际消费可能被抵消。余额下降也可能来自其他会话、设备、赠金过期或校正，不能归因于本会话。
- 历史页按北京时间展示最近七天观测下降；没有可比读数的日期显示「—」。新密钥首条读数显示「观测起点」，当前页今日变化显示「未知」；第二次成功查询后才有比较。失败、重复或过期读数不记账。
- 仅在 DSH 界面打开且页面可见时按原有 15 秒间隔采样。变化归入观测到的日期；跨日与未打开期间无法还原。保留每个密钥最近 240 次查询、最近 30 个观测日的汇总，最多保留最近 8 个密钥。数据存在本浏览器的 localStorage，不上传账本。
- 背景、正文、弱文字、边框、品牌、警告与错误色使用宿主 `--dsw-*` 语义变量，宿主深色属性提供回退色。局部预设：跟随宿主、工作蓝、海洋蓝、鲸鱼娘工坊；自定义强调色单独保存，可恢复默认。预设只装饰本插件面板，不注册或改写全站主题。
- 低余额阈值按 CNY / USD 设置，默认分别为 5 / 1；同一次低余额仅弹一次，余额回升再降低后才重新触发，并受 5–120 分钟的最短间隔限制（默认 30 分钟）。已欠费也会触发低余额提醒。关闭气泡后不反复打扰；提醒状态跨重载保留。
- 完成待查看提示可开关；完成气泡可手动关闭，查看对应会话后随真实未读状态消失。关闭气泡不会改动宿主会话状态。
- 本地存储不可用时保留本次内存中的查询与提醒状态，并在卡片提示无法持久保存。

构建与检查（Node.js 22+）：

```sh
npm install --include=dev
npm run build
npm test
npm run test:ui
```

`src/client.js` 是界面源文件，`lib/ledger.js` 为账目与设置逻辑；构建脚本合并生成无新增运行时依赖的 `lib/client.js`。开发依赖仅用于 React/jsdom 交互检查。

设计依据是用户提供的《DSH 高星插件报告》9.3–9.5 节；独立实现账目、主题与提醒，没有引入其他插件的代码、美术或音效。本次继续使用原有自制 48 帧素材。
