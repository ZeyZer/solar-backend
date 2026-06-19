# Draw My Roof Input Contract

## Purpose

This document defines the payload shape the future “Draw My Roof” frontend should send to the backend.

The contract is designed to support:

- manually drawn roof polygons now
- admin-entered corrections later
- future satellite/LiDAR-derived roof geometry
- future surveyed roof geometry
- future layout and topology engines

## Location in quote input

The frontend should send roof geometry at:

```js
input.roofGeometry