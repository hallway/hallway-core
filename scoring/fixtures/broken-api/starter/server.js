const express = require("express");
const app = express();
app.use(express.json());

const todos = [];
let nextId = 1;

// BUG: should be GET not POST
app.post("/todos", (req, res) => {
  res.json(todos);
});

// BUG: doesn't set id or push to array
app.post("/todos/create", (req, res) => {
  const todo = { title: req.body.title, done: false };
  res.json(todo);
});

// BUG: uses == instead of === and wrong field name
app.put("/todos/:id", (req, res) => {
  const todo = todos.find(t => t.identifier == req.params.id);
  if (!todo) return res.status(404).json({ error: "not found" });
  todo.done = req.body.done;
  res.json(todo);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

if (require.main === module) {
  app.listen(3000, () => console.log("listening on 3000"));
}
module.exports = app;
