# SimTower Clone

Build a SimTower-style tower building simulation game in a single HTML file with inline JavaScript and CSS.

## Requirements

- **Canvas-based rendering** — draw the tower, floors, elevators, and tenants on an HTML5 canvas
- **Building mechanics** — click to place floors, each floor costs money
- **Tenant system** — tenants move in automatically, pay rent over time
- **Elevator** — at least one elevator shaft that tenants use to move between floors
- **Economy** — start with seed money, earn rent, spend on floors. Show balance on screen.
- **UI** — show current money, floor count, tenant count, and a build button or click-to-build
- **Visual style** — side-view cross-section of a tower (like the original SimTower)
- **Game loop** — requestAnimationFrame-based, tenants animate, rent ticks periodically

## Technical Constraints

- Single `index.html` file, no external dependencies
- Must work in any modern browser
- Canvas size at least 800x600
