// Minh hoạ bàn nhìn từ trên xuống: màu theo trạng thái, có khách thì bày bát đũa, đang gọi thì chuông rung.
const TONE = {
  EMPTY: ['#efe6d8', '#d9cbb6'],
  DINING: ['#f6dcc9', '#b3352a'],
  AWAITING_PAYMENT: ['#f7e5bf', '#c0892b'],
  PAID: ['#d9ecdf', '#2e7550'],
  REFUND_DUE: ['#f8dcd6', '#b42318'],
  OUT_OF_SERVICE: ['#e6e1db', '#a89c90'],
};

export const STATE_COLOR = Object.fromEntries(Object.entries(TONE).map(([k, v]) => [k, v[1]]));

export default function TableArt({ state = 'EMPTY', seats = 4, busy }) {
  const [fill, stroke] = TONE[state] || TONE.EMPTY;
  const occupied = busy ?? !['EMPTY', 'OUT_OF_SERVICE'].includes(state);
  const chairs = Array.from({ length: seats }, (_, i) => (i * 360) / seats + 45);
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label="Sơ đồ bàn">
      {chairs.map((a) => (
        <g key={a} transform={`rotate(${a} 60 60)`}>
          <rect x="47" y="2" width="26" height="16" rx="7" fill={occupied ? stroke : '#e2d6c4'} opacity={occupied ? 0.9 : 1} />
        </g>
      ))}
      <circle cx="60" cy="60" r="38" fill={fill} stroke={stroke} strokeWidth="3" />
      <circle cx="60" cy="60" r="30" fill="none" stroke={stroke} strokeOpacity=".25" strokeDasharray="3 4" />
      {occupied &&
        chairs.map((a) => (
          <g key={`p${a}`} transform={`rotate(${a} 60 60)`}>
            <circle cx="60" cy="33" r="7.5" fill="#fffdf9" stroke={stroke} strokeOpacity=".5" />
            <circle cx="60" cy="33" r="4" fill={stroke} fillOpacity=".18" />
            <path d="M70 28v10" stroke="#8a6a4a" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        ))}
      {occupied && <circle cx="60" cy="60" r="8" fill="#fffdf9" stroke={stroke} strokeOpacity=".6" />}
      {state === 'OUT_OF_SERVICE' && <path d="M44 44l32 32M76 44 44 76" stroke={stroke} strokeWidth="4" strokeLinecap="round" />}
    </svg>
  );
}
