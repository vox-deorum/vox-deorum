## Debugging Lua stack in Windows debugger
- You will need a lua51_Win32.dll with pdb.
- Some useful commands:
  - Get the depth of stack
```L->ci - L->base_ci```

  - Check if a level is a C or a Lua function
```L->ci[-1].func->value.gc->cl.c.isC```

  - If Lua, get the line number of the level definition
```((LClosure*)(L->ci[-1].func->value.gc))->p->linedefined```
```((LClosure*)(L->ci[-1].func->value.gc))->p->lastlinedefined```

  - If Lua, get the line number of the instruction
```((LClosure*)(L->ci[-1].func->value.gc))->p->lineinfo[L->ci[-1].savedpc - ((LClosure*)(L->ci[-1].func->value.gc))->p->code]```
