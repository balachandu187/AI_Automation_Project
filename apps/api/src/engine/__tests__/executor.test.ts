// ============================================================================
// FlowMind Engine Tests — DAG Topological Sort
// ============================================================================
import { describe, it, expect } from "vitest";
import { buildDAG, topologicalSort, validateDAG } from "../executor.js";
import type { DAGNode, DAGEdge } from "../types.js";

function makeNode(id: string, type = "action", label?: string): DAGNode {
  return { id, type, label: label || id, config: {} };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
): DAGEdge {
  return { id, sourceNodeId: source, targetNodeId: target, condition: null };
}

describe("buildDAG", () => {
  it("builds adjacency maps correctly", () => {
    const nodes: DAGNode[] = [
      makeNode("trigger", "trigger"),
      makeNode("action1"),
      makeNode("action2"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "trigger", "action1"),
      makeEdge("e2", "trigger", "action2"),
    ];

    const dag = buildDAG(nodes, edges);

    expect(dag.nodes.size).toBe(3);
    expect(dag.adjacency.get("trigger")).toEqual(["action1", "action2"]);
    expect(dag.reverseAdjacency.get("action1")).toEqual(["trigger"]);
    expect(dag.reverseAdjacency.get("action2")).toEqual(["trigger"]);
    expect(dag.adjacency.get("action1")).toEqual([]);
  });

  it("handles empty graphs", () => {
    const dag = buildDAG([], []);
    expect(dag.nodes.size).toBe(0);
    expect(dag.adjacency.size).toBe(0);
  });
});

describe("topologicalSort", () => {
  it("sorts a simple linear DAG", () => {
    const nodes: DAGNode[] = [
      makeNode("trigger", "trigger"),
      makeNode("action1"),
      makeNode("action2"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "trigger", "action1"),
      makeEdge("e2", "action1", "action2"),
    ];
    const dag = buildDAG(nodes, edges);
    const levels = topologicalSort(dag);

    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(["trigger"]);
    expect(levels[1]).toEqual(["action1"]);
    expect(levels[2]).toEqual(["action2"]);
  });

  it("puts independent nodes in the same level", () => {
    const nodes: DAGNode[] = [
      makeNode("trigger", "trigger"),
      makeNode("action1"),
      makeNode("action2"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "trigger", "action1"),
      makeEdge("e2", "trigger", "action2"),
    ];
    const dag = buildDAG(nodes, edges);
    const levels = topologicalSort(dag);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toEqual(["trigger"]);
    // action1 and action2 can run in parallel
    expect(levels[1]).toEqual(
      expect.arrayContaining(["action1", "action2"]),
    );
    expect(levels[1]?.length).toBe(2);
  });

  it("handles diamond DAG pattern", () => {
    // trigger → A → C
    // trigger → B → C
    const nodes: DAGNode[] = [
      makeNode("trigger", "trigger"),
      makeNode("A"),
      makeNode("B"),
      makeNode("C"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "trigger", "A"),
      makeEdge("e2", "trigger", "B"),
      makeEdge("e3", "A", "C"),
      makeEdge("e4", "B", "C"),
    ];
    const dag = buildDAG(nodes, edges);
    const levels = topologicalSort(dag);

    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(["trigger"]);
    expect(levels[1]).toEqual(expect.arrayContaining(["A", "B"]));
    expect(levels[2]).toEqual(["C"]);
  });

  it("detects cycles and throws", () => {
    const nodes: DAGNode[] = [
      makeNode("A"),
      makeNode("B"),
      makeNode("C"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "A", "B"),
      makeEdge("e2", "B", "C"),
      makeEdge("e3", "C", "A"), // cycle!
    ];
    const dag = buildDAG(nodes, edges);

    expect(() => topologicalSort(dag)).toThrow("Cycle detected");
  });

  it("sorts a complex multi-level DAG", () => {
    // Level 0: trigger
    // Level 1: A, B  (parallel)
    // Level 2: C  (depends on A, B)
    // Level 3: D, E  (parallel, depend on C)
    // Level 4: F  (depends on D, E)
    const nodes: DAGNode[] = [
      makeNode("trigger", "trigger"),
      makeNode("A"),
      makeNode("B"),
      makeNode("C"),
      makeNode("D"),
      makeNode("E"),
      makeNode("F"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "trigger", "A"),
      makeEdge("e2", "trigger", "B"),
      makeEdge("e3", "A", "C"),
      makeEdge("e4", "B", "C"),
      makeEdge("e5", "C", "D"),
      makeEdge("e6", "C", "E"),
      makeEdge("e7", "D", "F"),
      makeEdge("e8", "E", "F"),
    ];
    const dag = buildDAG(nodes, edges);
    const levels = topologicalSort(dag);

    expect(levels).toHaveLength(5);
    expect(levels[0]).toEqual(["trigger"]);
    expect(levels[1]).toEqual(expect.arrayContaining(["A", "B"]));
    expect(levels[2]).toEqual(["C"]);
    expect(levels[3]).toEqual(expect.arrayContaining(["D", "E"]));
    expect(levels[4]).toEqual(["F"]);
  });
});

describe("validateDAG", () => {
  it("rejects empty DAGs", () => {
    const dag = buildDAG([], []);
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("at least one node"))).toBe(
      true,
    );
  });

  it("rejects DAGs without a trigger node", () => {
    const nodes: DAGNode[] = [makeNode("A", "action")];
    const dag = buildDAG(nodes, []);
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("trigger node")),
    ).toBe(true);
  });

  it("rejects DAGs with dangling edge references", () => {
    const nodes: DAGNode[] = [
      makeNode("trigger", "trigger"),
      makeNode("A"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "trigger", "A"),
      makeEdge("e2", "trigger", "non_existent"),
    ];
    const dag = buildDAG(nodes, edges);
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("unknown")),
    ).toBe(true);
  });

  it("rejects DAGs with cycles", () => {
    const nodes: DAGNode[] = [
      makeNode("trigger", "trigger"),
      makeNode("A"),
      makeNode("B"),
    ];
    const edges: DAGEdge[] = [
      makeEdge("e1", "trigger", "A"),
      makeEdge("e2", "A", "B"),
      makeEdge("e3", "B", "A"),
    ];
    const dag = buildDAG(nodes, edges);
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
  });

  it("accepts valid DAGs", () => {
    const nodes: DAGNode[] = [
      { id: "trigger", type: "trigger", label: "Trigger", config: { triggerType: "manual" } },
      { id: "A", type: "action", label: "Action", config: { actionType: "http_request", url: "https://example.com", method: "GET" } },
    ];
    const edges: DAGEdge[] = [makeEdge("e1", "trigger", "A")];
    const dag = buildDAG(nodes, edges);
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
