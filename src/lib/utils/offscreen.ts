//
// This is a nice to have, but I don't want to code myself into a corner by not thinking about it up front.
// 
// The main problem offscreen rendering solves is that I don't have to work on the main thread.
// my "builds" are the heavy bit, not the rendering.
//
// what I really need is a worker for the builds, so they can be Async, but they still have to return the geometries somehow.
// and they need to come back to the renderer.
// so we need a way to clone the geometries from the worker thread back to the main thread.

//
// then we could use another worker for the rendering, with an offscreen canvas.
// sounds way difficult.
//