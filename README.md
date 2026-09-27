# Claude Octopus: đồng hồ đo context cho Claude Code

Con mascot pixel của Claude nằm ở Activity Bar và **lớn dần lên theo lượng context** của session Claude Code đang chạy.
Khi context đầy, **click vào nó để chạy `/compact`**.

## Cách hoạt động
- Đọc transcript `~/.claude/projects/<project>/<session>.jsonl` của session mới nhất trong workspace, lấy `usage`
  của assistant message gần nhất: `input + cache_creation + cache_read + output` rồi chia cho context window (mặc định 200k, tự nhảy lên 1M khi vượt).
- `/compact` được gửi vào terminal đang chạy `claude` (tìm theo tên terminal, hoặc hỏi bạn chọn).
  Không tìm thấy terminal thì `/compact` được copy vào clipboard.

## Tương tác
| Thao tác | Kết quả |
|---|---|
| Click khi context ≥ ngưỡng (75%) | chạy `/compact` |
| Click khi context còn ít | chọc: nó đỏ mặt, thả tim (chọc 5 lần thì nó nhảy) |
| Double-click | `/compact` bất kỳ lúc nào (có hỏi xác nhận) |
| Rê chuột | mắt nhìn theo con trỏ |
| Xoa chuột qua lại trên đầu | xoa đầu: mắt ^^, đỏ mặt, lắc lư |
| Status bar `$(hubot) 42%` | click: mở view, hoặc `/compact` khi đã đầy |

## Các trạng thái và chuyển động
- **idle**: thở, chớp mắt, nhìn quanh, đi dạo, vẫy tay, nhảy, ngó nghiêng, gồng tay, gõ chân, vươn vai, nhảy múa, nói linh tinh,
  bướm bay tới đậu lên đầu, ngồi "loaf", ngâm nga (nốt nhạc ♪), hắt xì, nháy mắt ✧, ngại ngùng (mắt trái tim), nhào lộn
- **working** (Claude đang ghi transcript): chân gõ nhanh, bong bóng "•••"
- **vibe** (Claude tự code liên tục ≥ 60 giây, bạn chỉ ngồi chờ): kính râm rơi xuống mắt, đeo tai nghe, cầm ly cà phê sữa đá (ban ngày) hoặc cốc bia hơi Hà Nội (từ 17h);
  gật gù theo nhạc lo-fi, gõ chân theo nhịp, nhấp cà phê "slurp ☕" / nâng cốc "1, 2, 3… dzô! 🍺", nốt nhạc bay; "vibing ~ 🎧", "auto-accept mode 😎"
- **bored** (không có gì xảy ra ≥ 90 giây, trước khi ngủ): mắt lờ đờ, miệng thẳng, thở dài "haizz…";
  nằm dài tan chảy, thổi kẹo cao su đến nổ, chơi máy game cầm tay, đảo mắt, gõ chân sốt ruột; "gõ gì đi mà 🥱"
- **eating**: những gì Claude vừa nạp vào context bay vào miệng dưới dạng nhãn "kiến thức", rồi nó nhai và to ra:
  📄 file đã đọc · ✏️ file đã sửa · ›_ lệnh Bash · 🔍 grep/glob · 🌐 web · 🤖 subagent · 💬 prompt của bạn · 💡 suy nghĩ · 🖼️ ảnh · 🔧 tool khác.
  Chỉ lấy dòng mới được ghi vào transcript (không phát lại lịch sử cũ).
- **stressed** (≥ ngưỡng): đổi màu sang đỏ, đổ mồ hôi, run, bốc hơi
- **panic** (≥ 90%): rung, vung tay, há miệng, phát sáng đỏ, bong bóng "click me"
- **stuffed** (100%) — *sắp nổ tung*: ngồi bệt, người phồng, mắt `><`, xoa bụng, ợ bong bóng; viền đỏ nhấp nháy quanh view,
  thanh context thành vạch cảnh báo vàng-đỏ chạy, số % run rẩy, vết nứt phát sáng trên thân.
  Càng để lâu càng căng (3 cấp: 0–8s, 8–20s, >20s): thêm vết nứt, rung mạnh hơn, thở gấp hơn.
  Định kỳ nó **phồng to lên, nháy trắng ngày càng nhanh, cả view rung**, văng mảnh vụn… rồi cố nín lại "phew…".
  Khi `/compact` từ 100%: **💥 NỔ** — chớp trắng, sóng xung kích, mảnh pixel văng tứ tung, rồi bật lại nhỏ xíu "…I'm okay!"
- **compacting**: co bóp, nhắm mắt; xong thì ợ một cái, phồng lên và thu nhỏ, bắn sparkles, nhào lộn, mắt cười
- **sleep** (không có hoạt động sau 5 phút): nhắm mắt, thở chậm, "Zzz"
- **hibernate**: *prompt cache của Claude đã hết hạn* (mặc định 1 giờ sau lần gọi API cuối; TTL 5m/1h được đọc từ transcript).
  Nó đội mũ ngủ, ngồi cuộn lại, thở bong bóng mũi, trời chuyển đêm với trăng sao; HUD hiện `💤 cache cold`.
  Chọc thì nó chỉ nói mớ ("5 more minutes…"); chỉ khi có message mới gửi cho Claude nó mới giật mình dậy.
  Khi cache còn sống, HUD đếm ngược `⚡ 42m`.

## Chạy thử
- Dev: mở thư mục này trong VS Code, bấm **F5**.
- Cài hẳn (không cần build/npm): symlink vào thư mục extensions rồi Reload Window:
  `ln -s "$PWD" ~/.vscode/extensions/local.claude-octopus-0.1.0`
- Xem animation không cần VS Code: `python3 -m http.server 8765` rồi mở `http://localhost:8765/test/harness.html`.

## Theme theo mùa (`claudeOctopus.theme`, mặc định `auto`)
| Theme | Khi nào (auto) | Trang phục & hành động |
|---|---|---|
| 🐐 `messi` | 2–7/10/2026 (trận chia tay Argentina 6/10), 23–24/6, 18/12 | Áo sọc xanh-trắng, râu, băng đội trưởng, 3 ngôi sao, bóng dưới chân, khung thành; tâng bóng, sút "¡GOLAZO!", ăn mừng 🐐; compact xong nâng cúp 🏆 |
| 💐 `women` | 17–21/10 (20/10), 6–9/3 (8/3) | Vòng hoa trên đầu, cầm hoa hồng, cánh hoa rơi; tặng hoa 🌹, ngại ngùng |
| 🎄 `christmas` | 15–26/12 | Mũ Noel, tuyết rơi, cây thông + hộp quà; "Ho ho ho!", tặng quà 🎁, hát jingle bells |
| 🧧 `tet` | 7 ngày trước đến 7 ngày sau mùng 1 (2026–2035) | Đèn lồng đung đưa, cầm lì xì, hoa mai rơi, pháo hoa; "Lì xì nè!" |

HUD có thêm dải băng theo theme. Sự kiện ngắn thắng mùa dài (18/12 là Messi dù đang mùa Noel).
Đặt `theme` thành `none` để tắt, hoặc chọn thẳng một theme. Thêm ngày riêng bằng `claudeOctopus.themeDates`:
`[{ "theme": "messi", "from": "2026-10-03", "to": "2026-10-07" }]` (ngày dạng `YYYY-MM-DD`, hoặc `MM-DD` để lặp hằng năm).

## Không làm phiền khi đang code
| Setting | Mặc định | Ý nghĩa |
|---|---|---|
| `claudeOctopus.motion` | `calm` | `lively`: đầy đủ hiệu ứng (có chớp khi 100%) · `calm`: không chớp, không rung view, ít trò hơn · `minimal`: gần như đứng yên, chỉ thở, đổi size và màu |
| `claudeOctopus.quietWhileTyping` | `true` | Bạn gõ trong editor thì nó đứng yên 6 giây: không hạt, không thoại, không đi lại |
| `claudeOctopus.size` | `1` | Hệ số kích thước (0.3–2). Vẫn lớn dần theo context, nhưng không vượt khung view |
| `claudeOctopus.location` | `activitybar` | `activitybar` · `explorer` (một mục nhỏ trong Explorer) · `panel` (tab cạnh Terminal) · `hidden` (chỉ status bar) |
| `claudeOctopus.showSpeech` | `true` | Tắt bong bóng thoại (cảnh báo đầy context vẫn hiện) |
| `claudeOctopus.showStatusBar` | `true` | Ẩn hoặc hiện `42%` trên status bar |

Lệnh **Claude Octopus: Cycle Motion Level** chuyển nhanh `lively → calm → minimal`.
Hệ điều hành đang bật *Reduce motion* thì mọi animation lặp sẽ bị tắt.

## Settings
`claudeOctopus.contextWindow`, `compactThreshold`, `sessionSource` (`workspace`/`latest`),
`terminalNamePattern`, `confirmBelowThreshold`, `sleepAfterMinutes`, `cacheTtl` (`auto`/`5m`/`1h`), `theme`, `themeDates`, `vibeAfterSeconds`, `boredAfterSeconds`, cùng các setting ở mục trên.
