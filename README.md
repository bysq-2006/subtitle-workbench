# Coursera 字幕工作台

Tampermonkey / 油猴脚本：在 Coursera 视频页提取原字幕、复制给 AI 翻译、再把中文 SRT/VTT 叠回播放器。按课程集数缓存，支持普通播放和全屏。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 打开仓库里的 [`coursera-subtitle-workbench.user.js`](./coursera-subtitle-workbench.user.js)
3. 在 Tampermonkey 中新建脚本并粘贴，或直接用 Tampermonkey 打开该 `.user.js`

## 用法

1. 打开 Coursera 视频并先打开一种原字幕
2. 点击页面上的「字幕工作台」
3. 「识别原字幕」→「复制标题 + 提示词 + 字幕」发给翻译模型
4. 把返回的完整 SRT/VTT 粘贴进去，点「应用到当前视频」

同一集再次打开会自动恢复缓存。

版本：2.3.0
