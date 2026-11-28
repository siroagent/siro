---
name: setup
description: Check the Siro wallet and say the next setup step
---

Check whether the Siro wallet is ready. Never ask for the password and never handle it.

1. Run `siro address`. If the command is missing, or it says there is no wallet, give the user the commands under **Setup** in the siro skill and stop: they run `init` themselves, because it asks for a password.
2. Run `siro balance`. If every balance is zero, show the addresses to fund.
3. If the local `siro` MCP server is connected, call `siro_wallet` and report the caps and what was spent today. If it is not connected, the usual cause is that `SIRO_PASSWORD` was not exported in the shell that started the client: ask the user to export it, restart, and reconnect `siro` with `/mcp`.

End with one line: ready, or the single next step.
