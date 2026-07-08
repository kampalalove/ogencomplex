import express from "express";

const router = express.Router();

// fake in-memory database
let users = [];

// GET all users
router.get("/", (req, res) => {
  res.json(users);
});

// POST create user
router.post("/", (req, res) => {
  const newUser = {
    id: Date.now().toString(),
    ...req.body
  };

  users.push(newUser);

  res.json({
    message: "User created",
    user: newUser
  });
});

// GET single user
router.get("/:id", (req, res) => {
  const user = users.find(u => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json(user);
});

// UPDATE user
router.put("/:id", (req, res) => {
  const userId = req.params.id;
  const updatedData = req.body;

  const index = users.findIndex(u => u.id === userId);

  if (index === -1) {
    return res.status(404).json({ message: "User not found" });
  }

  users[index] = { ...users[index], ...updatedData };

  res.json({
    message: "User updated",
    user: users[index]
  });
});

// DELETE user
router.delete("/:id", (req, res) => {
  const userId = req.params.id;

  const index = users.findIndex(u => u.id === userId);

  if (index === -1) {
    return res.status(404).json({ message: "User not found" });
  }

  const deletedUser = users.splice(index, 1)[0];

  res.json({
    message: "User deleted",
    user: deletedUser
  });
});

export default router;