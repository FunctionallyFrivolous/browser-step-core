# Architecture

## Source of Truth

OpenCascade BRep

Three.js geometry is rendering only.

## Layers

Kernel
  OpenCascade/libcascade

Model
  Bodies
  Faces
  Edges

Rendering
  Three.js

Commands
  Undoable actions

Applications
  Viewer
  Style Editor
  GD&T Visualizer
  Future tools
