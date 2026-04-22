# 企业微信智能机器人 API 备忘

基于 `/document/path/100719`、`101463`、`101027`、`101031`、`101032`、`101033`。

面向 `@wecom/aibot-node-sdk` 长连接模式的开发笔记。

## 1. 接收消息（`aibot_msg_callback.body`）

顶层：
- `msgid` 去重用
- `aibotid`
- `chatid`（群聊存在）
- `chattype`: `single | group`
- `from.userid`（群聊可能带 `from.corpid`）
- `msgtype`: `text | image | mixed | voice | file | video | stream`
- `create_time`（秒）
- `response_url` 临时回复地址，5 分钟有效
- `quote` 可选

消息体：
- `text.content`
- `image`: `url / aeskey / md5 / file_size`（仅单聊）
- `voice`: `content`（转写）+ 媒体字段
- `file`: `filename / url / aeskey / md5 / file_size`，≤100MB，单聊
- `video`: 同 file
- `mixed.msg_item[]`：`{msgtype:"text",text}` 或 `{msgtype:"image",image}`
- `stream.id`：引用上次流式会话
- `quote.msgtype` + 子结构

媒体：下载 `url` → AES-256-CBC/PKCS#7，key=base64(aeskey)，IV=key 前 16B。长连接模式下**包体免加解密**，媒体本身仍需解密。

## 2. 接收事件（`aibot_event_callback.body`）

公共 `event.eventtype`。

- `enter_chat`：单聊当日首次进入
- `template_card_event`：`card_type / event_key / task_id / selected_items`
- `feedback_event`：`id / type(1=准/2=否/3=撤) / content / inaccurate_reason_list`
- `disconnected_event`（长连接独有）：被新连接挤下线

## 3. 被动回复

- 欢迎语（响 `enter_chat`，5s 内）：`text` 或 `template_card`
- 用户消息回复：
  - `stream`：`stream.id / finish / content(≤20480B, Markdown) / msg_item[]（仅 finish=true 可含图片 base64≤10M） / feedback.id`
  - `template_card`（含 `feedback.id`）
  - `stream_with_template_card`
- 卡片更新（`aibot_respond_update_msg`）5s 内
- 流式会话首条起 10 分钟超时
- `headers.req_id` 必须回传以绑定原 callback

## 4. 主动回复（`aibot_send_msg`）

前提：用户先在本会话中找过机器人。

- `chatid`：单聊=userid；群聊=chatid
- `chat_type`: 1=单 / 2=群 / 0=自动
- `msgtype`: `markdown | template_card`，上传媒体后可 `image/voice/video/file`
- 不走 5s 窗，不需 req_id 绑定

## 5. 模板卡片

公共：`card_type / source / main_title(≤26字标题,≤30字描述) / action_menu / task_id`。

- `text_notice`: emphasis / sub_title_text / horizontal_content_list / jump_list / **card_action 必填**
- `news_notice`: card_image / image_text_area / vertical_content_list / ...
- `button_interaction`: `button_list[]={text(≤10),style(1-4),key(≤1024)}`
- `vote_interaction` / `multiple_interaction`: `checkbox / submit_button / selectitem_list`

## 6. 流式消息刷新

- 同一 `stream.id` 多次追加替换显示
- `finish=true` 才能挂图片、进反馈
- 单片 ≤20480B
- 10 分钟超时；同时最多 3 条互动中

## 7. 加解密（仅 webhook）

长连接模式免除包体加解密，只有媒体文件仍需 AES 解密。

## 8. 长连接指令（101463）

- `aibot_subscribe {bot_id, secret}`
- `aibot_msg_callback`（S→C）
- `aibot_event_callback`（S→C）
- `aibot_respond_welcome_msg` / `aibot_respond_msg` / `aibot_respond_update_msg`
- `aibot_send_msg`
- 媒体上传三步：`aibot_upload_media_init/chunk/finish`，单片 ≤512KB，≤100 片，会话 30 分钟
- `ping` 30s 心跳
- 一个 bot 同一时刻只能一条长连接；新 subscribe 挤掉旧
- 所有请求带 `req_id`，服务端按 req_id 回包

## 9. 限制

- 频控：30 条/分钟、1000 条/小时（回复+主动合计）
- 媒体：image ≤10MB、voice ≤2MB、video/file ≤100MB 接收、上传 10MB
- 群聊不接收 image/file/video
- 主动发送需已有会话
- `msgid` 必须幂等
- `response_url` 5 分钟过期
- `quote` 只在用户显式引用时出现
