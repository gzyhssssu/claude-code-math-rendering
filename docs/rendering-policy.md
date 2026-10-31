# Rendering policy audit / 公式渲染逻辑检查

Version 0.2 treats explicit, complete formula delimiters as math intent. It does not try to decide whether a Greek letter, a number, or a variable product "looks mathematical enough".

## Gates changed

| Layer | Observed filter | Effect and fix |
| --- | --- | --- |
| Shared inline guard | 60-character count and 1024-character span | Replaced the length/content guard with a nonempty, single-line delimiter policy. Existing 0.1 patches are upgraded. |
| Shared inline guard | ASCII left/right context whitelist | ASCII quotes could reject `"$x$"` and the quoted `"把 ψ 换成 $\hat\phi$"` heading. Explicit formulas no longer require that whitelist. |
| Shared inline guard | Single-character ASCII-letter rule | Greek characters and digits were rejected even between complete delimiters. `$α$` and `$1$` now qualify. |
| Shared inline guard | Leading-digit and restricted arithmetic-expression tests | `$2x$`, `$10$`, `$xy$`, `$x_ij$`, and `$Q1(a)$` no longer require a command, operator, or specially shaped subscript. |
| Shared inline guard | Natural-language, punctuation, and markup-shaped content guesses | Explicit math is passed to KaTeX instead of rejected by those guesses. Invalid TeX can still fail in KaTeX. |
| Primary Markdown scanner | Currency and spreadsheet-reference prefilters | These ran before the shared guard and could independently reject digit-leading expressions and some adjacent characters. Removed from recognized scanner code. |
| Primary Markdown scanner | Numeric or capital-letter suffix after a closing dollar | A complete `$x$A` or `$x$2` no longer waits for a different suffix to be considered closed. Actual unmatched and streaming delimiters still use the original sentinels. |
| Alternate mdast renderer | A separate currency/spreadsheet scanner | Its equivalent early checks are removed too, so fixing the primary path does not leave a second rejection path. |
| Backslash inline guard | 200-character count, 1024 span, operator/superscript requirement | `\(1\)`, `\(α\)`, and long backslash formulas are accepted as explicit formulas. |
| One-line display guard | Span and "looks like math" tests | Explicit `\[…\]` content needs to be nonempty; a plain variable/number is sufficient. |
| Explicit math fence | Prose-word counting | A block explicitly marked as math is allowed through to the renderer rather than guessed to be prose. |

The installed build's redundant character tests included bounded scans across formatting markers. The new shared predicate does not rely on those context scans.

## Rules intentionally retained

- Markdown code spans and ordinary code fences remain code.
- Escaped opening dollars remain literal; escaped closing dollars are skipped while finding the real closer.
- Link destinations remain URLs. Math in a link label can render without interpreting its destination as math.
- Empty, whitespace-only, whitespace-padded inline content and inline expressions crossing line breaks are rejected.
- `$$…$$` remains block/display syntax rather than being swallowed as a single-dollar inline expression.
- Unclosed input and existing link-label/streaming boundaries retain their parser sentinels.
- Common monetary text such as `$20 and $30` and ranges such as `$5-$10` stay literal in the tested cases.
- KaTeX commands, supported syntax, error handling, `trust`, macro-expansion limits, and display-size limits are not changed. This tool cannot make an unsupported TeX command render correctly.
- The HTTP cache's encoded response size remains unchanged; changed modules' compiled bytecode is invalidated with a backup.

## Ambiguity and scope

An explicit `$10$` now means a mathematical number. Paired dollar signs around ordinary words or shell-like strings can likewise become math; escape literal dollars with `\$` or use a code span. Currency and math are inherently ambiguous, so the retained monetary examples are not a general natural-language classifier.

The currently recognized asset families are the shared guard, the primary inline parser, and the alternate renderer helper. Other app builds may reorganize these modules. Structural checks and a non-executing module syntax check must pass before writing. Historical or unfamiliar cache resources can be skipped; the tool cannot determine which cached build an active page will load. Always verify the live conversation view.

The local investigation used cached vendor code only for private verification. Public tests use authored synthetic modules. No extracted app source or private screenshots are included in the repository.

## 中文说明

截图中的 `\hat\phi` 本身是有效的 TeX；该场景主要被引号边界判断挡住。单字符另有“必须是 ASCII 字母”的过滤，纯数字、数字开头和连写变量又分别受到内容猜测与更早一层货币／单元格扫描影响。因此，本版本同时处理公共过滤器、主解析器和备用解析器，而非只修改字符上限。

完整公式定界符优先表示数学意图；代码、转义、链接目标、未闭合输入及 KaTeX 安全限制保留。金额等含义有歧义的文本请显式转义或放进代码行内标记。兼容性仍需按实际前端版本验证。
