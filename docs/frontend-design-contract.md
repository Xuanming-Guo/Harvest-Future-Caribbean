# Front-end design contract

Harvest must feel like one product across the participant website and simulation
control room. New user-facing controls must be custom and tailored to the
existing visual language; a browser's or operating system's default widget is
not an acceptable final interface.

## Required approach

- Use existing Harvest buttons, fields, cards, dialogs, badges, and tokens where they fit.
- Use accessible custom controls for selection, multi-selection, date/time, colour, range, and other interactions that would otherwise expose native browser/OS chrome, popup menus, or scroll arrows.
- Preserve accessible names, keyboard operation, focus visibility, disabled state, and screen-reader semantics.
- Verify changed controls in Chrome at the intended viewport before hand-off.

## Disallowed final UI

Do not ship raw native selects or multi-select listboxes, browser date/time or colour pickers, default file controls, or platform-default scrollbars/arrows as the visible product interaction. Native inputs may be used internally when their browser chrome is fully replaced by a tested custom presentation.

This rule applies to new features and touched controls. It does not require a bulk rewrite of unrelated existing screens.
