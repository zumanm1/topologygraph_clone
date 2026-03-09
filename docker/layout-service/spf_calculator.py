"""
SPF (Shortest Path First) Calculator for What-If Analysis
Implements Dijkstra's algorithm to calculate cost matrices for network topology scenarios
"""

import heapq
from typing import Dict, List, Set, Tuple, Any, Optional
import json


class SPFCalculator:
    """Calculate shortest paths and cost matrices for network topologies."""
    
    def __init__(self, topology_data: Dict[str, Any]):
        """
        Initialize SPF calculator with topology data.
        
        Args:
            topology_data: Graph data with nodes and edges
                Expected format: {
                    "nodes": [{"id": "node1", ...}, ...],
                    "edges": [{"source": "node1", "target": "node2", "cost": 10}, ...]
                }
        """
        self.nodes = {node["id"]: node for node in topology_data.get("nodes", [])}
        self.edges = topology_data.get("edges", [])
        self.adjacency = self._build_adjacency_list()
    
    def _build_adjacency_list(self) -> Dict[str, List[Tuple[str, int]]]:
        """Build adjacency list from edges."""
        adjacency = {node_id: [] for node_id in self.nodes}
        
        for edge in self.edges:
            source = edge.get("source")
            target = edge.get("target")
            cost = edge.get("cost", 1)
            
            if source in adjacency and target in adjacency:
                adjacency[source].append((target, cost))
                # OSPF is bidirectional by default
                adjacency[target].append((source, cost))
        
        return adjacency
    
    def dijkstra(self, source: str) -> Dict[str, int]:
        """
        Run Dijkstra's algorithm from a source node.
        
        Args:
            source: Source node ID
            
        Returns:
            Dictionary mapping destination node IDs to shortest path costs
        """
        if source not in self.nodes:
            return {}
        
        distances = {node_id: float('inf') for node_id in self.nodes}
        distances[source] = 0
        
        # Priority queue: (distance, node_id)
        pq = [(0, source)]
        visited = set()
        
        while pq:
            current_dist, current_node = heapq.heappop(pq)
            
            if current_node in visited:
                continue
            
            visited.add(current_node)
            
            # Explore neighbors
            for neighbor, edge_cost in self.adjacency.get(current_node, []):
                if neighbor in visited:
                    continue
                
                new_dist = current_dist + edge_cost
                
                if new_dist < distances[neighbor]:
                    distances[neighbor] = new_dist
                    heapq.heappush(pq, (new_dist, neighbor))
        
        return distances
    
    def calculate_cost_matrix(self) -> Dict[str, Dict[str, int]]:
        """
        Calculate full cost matrix for all node pairs.
        
        Returns:
            Nested dictionary: {source: {destination: cost}}
        """
        matrix = {}
        
        for source in self.nodes:
            matrix[source] = self.dijkstra(source)
        
        return matrix
    
    def apply_node_failure(self, failed_node: str) -> 'SPFCalculator':
        """
        Create a new calculator with a node removed (simulating node failure).
        
        Args:
            failed_node: ID of the node to fail
            
        Returns:
            New SPFCalculator instance with node removed
        """
        if failed_node not in self.nodes:
            raise ValueError(f"Node {failed_node} not found in topology")
        
        # Remove node and all its edges
        new_nodes = [node for node in self.nodes.values() if node["id"] != failed_node]
        new_edges = [
            edge for edge in self.edges
            if edge["source"] != failed_node and edge["target"] != failed_node
        ]
        
        return SPFCalculator({
            "nodes": new_nodes,
            "edges": new_edges
        })
    
    def apply_link_failure(self, source: str, target: str) -> 'SPFCalculator':
        """
        Create a new calculator with a link removed (simulating link failure).
        
        Args:
            source: Source node of the link
            target: Target node of the link
            
        Returns:
            New SPFCalculator instance with link removed
        """
        # Remove the specific edge (bidirectional)
        new_edges = [
            edge for edge in self.edges
            if not ((edge["source"] == source and edge["target"] == target) or
                   (edge["source"] == target and edge["target"] == source))
        ]
        
        return SPFCalculator({
            "nodes": list(self.nodes.values()),
            "edges": new_edges
        })
    
    def apply_cost_changes(self, cost_changes: List[Dict[str, Any]]) -> 'SPFCalculator':
        """
        Create a new calculator with modified edge costs.
        
        Args:
            cost_changes: List of cost modifications
                Format: [{"source": "node1", "target": "node2", "new_cost": 50}, ...]
                
        Returns:
            New SPFCalculator instance with updated costs
        """
        # Create a map of cost changes for quick lookup
        change_map = {}
        for change in cost_changes:
            src, tgt = change["source"], change["target"]
            new_cost = change["new_cost"]
            change_map[(src, tgt)] = new_cost
            change_map[(tgt, src)] = new_cost  # Bidirectional
        
        # Apply cost changes to edges
        new_edges = []
        for edge in self.edges:
            src, tgt = edge["source"], edge["target"]
            if (src, tgt) in change_map:
                new_edge = edge.copy()
                new_edge["cost"] = change_map[(src, tgt)]
                new_edges.append(new_edge)
            else:
                new_edges.append(edge)
        
        return SPFCalculator({
            "nodes": list(self.nodes.values()),
            "edges": new_edges
        })
    
    def calculate_statistics(self, baseline_matrix: Dict[str, Dict[str, int]], 
                           modified_matrix: Dict[str, Dict[str, int]]) -> Dict[str, Any]:
        """
        Calculate statistics comparing baseline and modified cost matrices.
        
        Args:
            baseline_matrix: Original cost matrix
            modified_matrix: Modified cost matrix after scenario
            
        Returns:
            Dictionary with statistics about the changes
        """
        paths_lost = []
        paths_improved = []
        paths_degraded = []
        total_cost_baseline = 0
        total_cost_modified = 0
        path_count = 0
        
        for src in baseline_matrix:
            for dst in baseline_matrix[src]:
                if src == dst:
                    continue
                
                baseline_cost = baseline_matrix[src][dst]
                modified_cost = modified_matrix.get(src, {}).get(dst, float('inf'))
                
                # Skip infinite baseline costs (no path originally)
                if baseline_cost == float('inf'):
                    continue
                
                path_count += 1
                total_cost_baseline += baseline_cost
                
                if modified_cost == float('inf'):
                    # Path lost
                    paths_lost.append({
                        "source": src,
                        "destination": dst,
                        "baseline_cost": baseline_cost
                    })
                elif modified_cost < baseline_cost:
                    # Path improved
                    improvement_pct = ((baseline_cost - modified_cost) / baseline_cost) * 100
                    paths_improved.append({
                        "source": src,
                        "destination": dst,
                        "baseline_cost": baseline_cost,
                        "modified_cost": modified_cost,
                        "improvement_percent": round(improvement_pct, 2)
                    })
                    total_cost_modified += modified_cost
                elif modified_cost > baseline_cost:
                    # Path degraded
                    degradation_pct = ((modified_cost - baseline_cost) / baseline_cost) * 100
                    paths_degraded.append({
                        "source": src,
                        "destination": dst,
                        "baseline_cost": baseline_cost,
                        "modified_cost": modified_cost,
                        "degradation_percent": round(degradation_pct, 2)
                    })
                    total_cost_modified += modified_cost
                else:
                    total_cost_modified += modified_cost
        
        # Calculate average cost change
        avg_cost_baseline = total_cost_baseline / path_count if path_count > 0 else 0
        avg_cost_modified = total_cost_modified / (path_count - len(paths_lost)) if (path_count - len(paths_lost)) > 0 else 0
        
        # Find isolated nodes (nodes with no outgoing paths)
        isolated_nodes = []
        for node in modified_matrix:
            reachable = sum(1 for dst, cost in modified_matrix[node].items() 
                          if dst != node and cost != float('inf'))
            if reachable == 0:
                isolated_nodes.append(node)
        
        return {
            "total_paths": path_count,
            "paths_lost": len(paths_lost),
            "paths_improved": len(paths_improved),
            "paths_degraded": len(paths_degraded),
            "paths_unchanged": path_count - len(paths_lost) - len(paths_improved) - len(paths_degraded),
            "avg_cost_baseline": round(avg_cost_baseline, 2),
            "avg_cost_modified": round(avg_cost_modified, 2),
            "avg_cost_change_percent": round(((avg_cost_modified - avg_cost_baseline) / avg_cost_baseline * 100), 2) if avg_cost_baseline > 0 else 0,
            "isolated_nodes": isolated_nodes,
            "paths_lost_details": paths_lost[:10],  # Limit to top 10
            "paths_improved_details": sorted(paths_improved, key=lambda x: x["improvement_percent"], reverse=True)[:10],
            "paths_degraded_details": sorted(paths_degraded, key=lambda x: x["degradation_percent"], reverse=True)[:10]
        }


def apply_scenario(topology_data: Dict[str, Any], scenario_config: Dict[str, Any]) -> Tuple[Dict, Dict, Dict]:
    """
    Apply a what-if scenario to topology and calculate matrices.
    
    Args:
        topology_data: Original topology data
        scenario_config: Scenario configuration
        
    Returns:
        Tuple of (baseline_matrix, modified_matrix, statistics)
    """
    # Calculate baseline
    baseline_calc = SPFCalculator(topology_data)
    baseline_matrix = baseline_calc.calculate_cost_matrix()
    
    # Apply scenario
    scenario_type = scenario_config.get("type")
    
    if scenario_type == "node_failure":
        failed_node = scenario_config.get("node_id")
        modified_calc = baseline_calc.apply_node_failure(failed_node)
    
    elif scenario_type == "link_failure":
        source = scenario_config.get("source")
        target = scenario_config.get("target")
        modified_calc = baseline_calc.apply_link_failure(source, target)
    
    elif scenario_type == "cost_change":
        cost_changes = scenario_config.get("changes", [])
        modified_calc = baseline_calc.apply_cost_changes(cost_changes)
    
    elif scenario_type == "multi_change":
        # Apply multiple changes in sequence
        modified_calc = baseline_calc
        for change in scenario_config.get("changes", []):
            change_type = change.get("type")
            if change_type == "node_failure":
                modified_calc = modified_calc.apply_node_failure(change["node_id"])
            elif change_type == "link_failure":
                modified_calc = modified_calc.apply_link_failure(change["source"], change["target"])
            elif change_type == "cost_change":
                modified_calc = modified_calc.apply_cost_changes([change])
    
    else:
        raise ValueError(f"Unknown scenario type: {scenario_type}")
    
    # Calculate modified matrix
    modified_matrix = modified_calc.calculate_cost_matrix()
    
    # Calculate statistics
    statistics = baseline_calc.calculate_statistics(baseline_matrix, modified_matrix)
    
    return baseline_matrix, modified_matrix, statistics
