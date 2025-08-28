# pip install osmnx==1.9.3 networkx numpy shapely lxml
import osmnx as ox
import networkx as nx
import numpy as np
from shapely.geometry import LineString
from math import pi

# --- Inputs ---
center_lat, center_lon = 49.2827, -123.1207     # Vancouver example
target_distance_km = 40.0                        # desired loop length
n_anchors = 24                                   # every 15 degrees
tolerance_km = 1.0                               # band half-width for anchors
surface_pref = "paved"                           # or "any","gravel"
start_from_center = True                         # else snap to nearest safe node

# --- Prep ---
ox.settings.log_console = False
radius_m = (target_distance_km * 1000) / (2 * pi)

# Pull a bike-sensible graph (use 'bike' profile; includes cycleways, residential, etc.)
G = ox.graph_from_point(
    (center_lat, center_lon),
    dist=radius_m * 1.7,  # padding to have options
    network_type="bike",
    simplify=True,
)

# Optional: filter by surface
if surface_pref == "paved":
    # drop clearly unpaved edges if tagged
    drop = []
    for u, v, k, data in G.edges(keys=True, data=True):
        surf = str(data.get("surface", "")).lower()
        if any(s in surf for s in ["gravel", "dirt", "ground", "unpaved", "fine_gravel", "compacted"]):
            drop.append((u, v, k))
    G.remove_edges_from(drop)
    G = ox.utils_graph.get_undirected(G)

# Snap start
center_node = ox.distance.nearest_nodes(G, center_lon, center_lat)
start_node = center_node
if not start_from_center:
    # could choose a known trailhead or user-picked start; for now keep center
    pass

# Precompute shortest-path distances from start
dist_from_start = nx.shortest_path_length(G, source=start_node, weight="length")

# Define the target band around the radius
target_m = radius_m
band_lower = target_m - (tolerance_km * 1000)
band_upper = target_m + (tolerance_km * 1000)

# Build anchors around bearings
center_xy = np.array(ox.utils_geo.xy(center_lat, center_lon)[::-1])  # (x,y) but we only use for bearings
nodes_xy = {n: (data["x"], data["y"]) for n, data in G.nodes(data=True)}

# Partition candidate nodes by bearing from center
def bearing_deg(p_from, p_to):
    dx = p_to[0] - p_from[0]
    dy = p_to[1] - p_from[1]
    ang = (np.degrees(np.arctan2(dx, dy)) + 360) % 360
    return ang

bins = np.linspace(0, 360, n_anchors + 1)
anchors = []
for i in range(n_anchors):
    b0, b1 = bins[i], bins[i + 1]
    # candidates within the iso-distance band and bearing slice
    best = None
    best_score = 1e18
    for n, d in dist_from_start.items():
        if band_lower <= d <= band_upper:
            b = bearing_deg(center_xy, nodes_xy[n])
            # distance-to-band center + how off the band midpoint angle
            score = abs(d - target_m) + 2.0 * min(abs(b - (b0 + b1) / 2), 360 - abs(b - (b0 + b1) / 2))
            if score < best_score:
                best_score = score
                best = n
    if best is not None:
        anchors.append(best)

# Ensure unique & ordered anchors
anchors = list(dict.fromkeys(anchors))  # drop duplicates in-order
if len(anchors) < 6:
    raise RuntimeError("Not enough anchors found. Increase tolerance_km, padding radius, or n_anchors.")

# Connect anchors in a loop with shortest paths
route_nodes = [start_node]
# Find closest anchor to start to begin
d2 = [(nx.shortest_path_length(G, start_node, a, weight="length"), a) for a in anchors]
_, first_anchor = min(d2, key=lambda x: x[0])
idx = anchors.index(first_anchor)
ordered = anchors[idx:] + anchors[:idx]  # rotate to start at closest

# go out to first anchor
route_nodes += nx.shortest_path(G, start_node, ordered[0], weight="length")[1:]
# go around anchors
for a, b in zip(ordered, ordered[1:] + ordered[:1]):
    seg = nx.shortest_path(G, a, b, weight="length")
    route_nodes += seg[1:]
# return to start
back = nx.shortest_path(G, route_nodes[-1], start_node, weight="length")
route_nodes += back[1:]

# Build geometry
coords = [(G.nodes[n]["y"], G.nodes[n]["x"]) for n in route_nodes]  # lat, lon
line = LineString([(lon, lat) for lat, lon in coords])

# Basic circularity & length metrics
def haversine_m(a, b):
    from math import radians, sin, cos, asin, sqrt
    lat1, lon1 = a
    lat2, lon2 = b
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    lat1 = radians(lat1); lat2 = radians(lat2)
    h = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
    return 2 * 6371000 * asin(sqrt(h))

length_m = sum(haversine_m(coords[i], coords[i+1]) for i in range(len(coords)-1))

# Export GPX
from lxml import etree
gpx = etree.Element("gpx", version="1.1", creator="circle-router", xmlns="http://www.topografix.com/GPX/1/1")
trk = etree.SubElement(gpx, "trk")
name = etree.SubElement(trk, "name"); name.text = "Circular Route"
trkseg = etree.SubElement(trk, "trkseg")
for lat, lon in coords:
    etree.SubElement(trkseg, "trkpt", lat=f"{lat:.7f}", lon=f"{lon:.7f}")
etree.ElementTree(gpx).write("circular_route.gpx", encoding="UTF-8", xml_declaration=True)

print(f"Route length: {length_m/1000:.2f} km, anchors used: {len(anchors)}")