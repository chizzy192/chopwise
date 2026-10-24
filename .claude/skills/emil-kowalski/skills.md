---
name: emil-kowalski-motion
description: "Applies high-end animation theory, micro-interactions, and easing to UI components."
user_invocable: true
---
# Emil Kowalski UI Motion Principles
1. Never animate high-frequency or keyboard actions (actions hit 100+ times/day).
2. Use strict UI purpose for transitions. Under 300ms duration.
3. Use custom easing curves (cubic-bezier) and ease-out; never use generic ease-in.
4. Scale effects: Buttons require an `:active` state scale change down to exactly `0.97`.
5. GPU efficiency: Only animate `transform` and `opacity`. Respect `prefers-reduced-motion`.
