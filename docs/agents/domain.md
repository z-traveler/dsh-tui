# Domain docs

按单一上下文维护：术语表放根目录 `GLOSSARY.md`，决策记录放 `docs/adr/`。
vendored workspace 包不构成另一个业务上下文。

探索代码前，如有 `GLOSSARY-MAP.md`，读取其相关术语表；否则读取根 `GLOSSARY.md`。
设计改动前读取相关 ADR，沿用其中术语和边界；与既有决策冲突时先说明，不静默覆盖。
文件缺失时直接继续，不预建空术语表或 ADR；仅在实际澄清术语或作出决策时记录。
