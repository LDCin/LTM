import { useEffect, useRef, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { formatVnd } from '../lib/format.js';

const GREETING = {
  role: 'bot',
  text: 'Chào bạn! Bàn mình đi mấy người, thích ăn gì, ngân sách khoảng bao nhiêu hay có kiêng gì không? Mình sẽ gợi ý món phù hợp.',
};
const QUICK = ['2 người, khoảng 200 nghìn', 'Món nào ra nhanh?', 'Gợi ý đồ uống', 'Không ăn cay'];

/**
 * Trợ lý gợi ý món. Chỉ gợi ý: khách tự bấm "Thêm vào giỏ" rồi đặt món như bình thường.
 * Lịch sử trò chuyện giữ trong trình duyệt; mỗi lần hỏi gửi tối đa 10 tin gần nhất cho máy chủ.
 */
export default function AssistantChat({ token, sessionId, itemsById, canOrder, onAdd, onError }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function send(text) {
    const question = text.trim().slice(0, 500);
    if (!question || busy) return;
    const history = [...messages, { role: 'user', text: question }];
    setMessages(history);
    setInput('');
    setBusy(true);
    try {
      const { data } = await request('POST', '/api/assistant/chat', {
        tableToken: token,
        sessionId,
        body: { messages: history.slice(-10).map(({ role, text: t }) => ({ role, text: t })) },
      });
      setMessages((m) => [...m, { role: 'bot', text: data.reply, suggestions: data.suggestions, source: data.source, notice: data.notice }]);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'SESSION_ENDED' || e.code === 'TABLE_CLOSED')) {
        onError(e);
        return;
      }
      setMessages((m) => [...m, { role: 'bot', text: e.message || 'Không kết nối được, bạn thử lại nhé.', error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="assistant-fab" onClick={() => setOpen(true)} title="Hỏi trợ lý gợi ý món">
        💬 Gợi ý món
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal assistant" onClick={(e) => e.stopPropagation()}>
            <div className="assistant-head">
              <strong>💬 Trợ lý gợi ý món</strong>
              <button className="btn small" onClick={() => setOpen(false)}>Đóng</button>
            </div>
            <div className="assistant-log">
              {messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role} ${m.error ? 'error' : ''}`}>
                  <div>{m.text}</div>
                  {m.notice && <div className="hint">{m.notice}</div>}
                  {m.suggestions?.map((s) => {
                    const item = itemsById.get(s.menuItemId);
                    return (
                      <div key={s.menuItemId} className="suggestion">
                        <div>
                          <strong>{s.quantity}× {s.name}</strong> · {formatVnd(s.price)}
                          {s.reason && <div className="hint">{s.reason}</div>}
                        </div>
                        <button
                          className="btn small primary"
                          disabled={!item || !canOrder}
                          onClick={() => onAdd(item, s.quantity)}
                        >
                          Thêm vào giỏ
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
              {busy && <div className="bubble bot typing">Đang nghĩ…</div>}
              <div ref={endRef} />
            </div>
            {messages.length === 1 && (
              <div className="assistant-quick">
                {QUICK.map((q) => (
                  <button key={q} className="btn small" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            <form
              className="assistant-input"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                maxLength={500}
                placeholder="VD: 4 người, có trẻ con, không ăn cay"
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn primary" disabled={busy || !input.trim()}>
                Gửi
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
