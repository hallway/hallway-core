const http = require("http");
const app = require("./server");

let server;
let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: "localhost", port: 3001, path, method, headers: { "Content-Type": "application/json" } };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (d) => data += d);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data || "null") }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(name, condition) {
  if (condition) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name); }
}

async function run() {
  server = app.listen(3001);
  try {
    // Test 1: GET /todos returns array
    const list = await request("GET", "/todos");
    assert("GET /todos returns 200", list.status === 200);
    assert("GET /todos returns array", Array.isArray(list.body));

    // Test 2: POST /todos creates a todo with id
    const created = await request("POST", "/todos", { title: "buy milk" });
    assert("POST /todos returns 201 or 200", created.status === 200 || created.status === 201);
    assert("created todo has id", created.body && created.body.id != null);
    assert("created todo has title", created.body && created.body.title === "buy milk");

    // Test 3: GET /todos includes created todo
    const list2 = await request("GET", "/todos");
    assert("GET /todos has 1 item", list2.body && list2.body.length === 1);

    // Test 4: PUT /todos/:id updates
    if (created.body && created.body.id) {
      const updated = await request("PUT", "/todos/" + created.body.id, { done: true });
      assert("PUT updates todo", updated.status === 200);
      assert("todo is now done", updated.body && updated.body.done === true);
    } else {
      assert("PUT updates todo", false);
      assert("todo is now done", false);
    }

    console.log("\n" + passed + " passed, " + failed + " failed");
  } finally {
    server.close();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
