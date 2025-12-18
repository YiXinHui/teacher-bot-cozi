// 文件路径: api/coze.js
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 1. 接收 conversationId (房间号)
    const { token, botId, message, userId, conversationId } = req.body;

    if (!token || !botId || !message) {
        return res.status(400).json({ success: false, error: '缺少参数' });
    }

    const COZE_API_BASE = 'https://api.coze.cn/v3';

    try {
        // 2. 构造请求体
        const payload = {
            bot_id: botId,
            user_id: userId || 'user_001',
            stream: false,
            auto_save_history: true,
            additional_messages: [
                {
                    role: 'user',
                    content: message,
                    content_type: 'text'
                }
            ]
        };

        // 🌟 关键点：如果有房间号，就带上！
        if (conversationId) {
            payload.conversation_id = conversationId;
        }

        console.log("1. 发起对话...");
        const chatResponse = await fetch(`${COZE_API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const chatData = await chatResponse.json();
        
        if (chatData.code !== 0 || !chatData.data) {
            throw new Error(`扣子报错: ${chatData.msg || JSON.stringify(chatData)}`);
        }

        // 获取本次的房间号
        const { conversation_id: newConversationId, id: chat_id } = chatData.data;

        // ... (轮询逻辑保持不变) ...
        let status = 'created';
        let retries = 0;
        while (status !== 'completed' && retries < 15) { // 稍微增加点耐心到15秒
            await new Promise(r => setTimeout(r, 1000));
            const checkRes = await fetch(`${COZE_API_BASE}/chat/retrieve?conversation_id=${newConversationId}&chat_id=${chat_id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const checkData = await checkRes.json();
            if (checkData.data) {
                status = checkData.data.status;
                if (status === 'failed' || status === 'canceled') throw new Error('AI思考失败');
            }
            retries++;
        }

        if (status !== 'completed') throw new Error('AI响应超时');

        const msgRes = await fetch(`${COZE_API_BASE}/chat/message/list?conversation_id=${newConversationId}&chat_id=${chat_id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const msgData = await msgRes.json();
        const aiMsg = msgData.data.find(m => m.role === 'assistant' && m.type === 'answer');

        if (aiMsg) {
            // 🌟 3. 把回复和房间号一起返回给前端
            return res.status(200).json({ 
                success: true, 
                reply: aiMsg.content,
                conversationId: newConversationId 
            });
        } else {
            return res.status(500).json({ success: false, error: '未找到回复' });
        }

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
