# Frozen public map fixture

`vancouver-west-end-2026-10-25.osm.json.gz` is the actual previously validated Overpass response for the Vancouver West End example, not a user location or a new request. OSM base timestamp: 2026-10-25T01:44:06Z. Center 49.289, −123.128, search radius 1 km (query includes a 50 m guard), roads, all returned way geometry nodes and turn restrictions. 12,148 elements; uncompressed 2,150,647 bytes. Uncompressed SHA-256: `ec1ddc51603b2b0f63c8ecf67970deab999ce9de200a638d127c9e59d6c28a16`.

Data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). It is retained unchanged as a deterministic correctness/benchmark input. No online service is contacted by tests. This snapshot does not establish current access or on-the-ground riding conditions. Historical acquisition/validation: `docs/live-data-validation.md`.

## Adaptive-corridor snapshots (2026-10-28)

Two actual small Vancouver corridor responses at public center 49.289, −123.128, circle radius 500 m. These are separate full snapshots, not merged data. They preserve the original rejected 86%-off-target candidate. A subsequent offline regression reproduces that original-anchor failure and validates a bounded junction-anchor fallback that recovers a route from the same unchanged data; this is not a new live check. The second query includes two localized connection patches; neither is complete disk coverage. See `docs/adaptive-corridor-prototype.md` for acquisition and limits.

| Gzipped fixture | OSM timestamp | Elements | Normalized JSON bytes | Uncompressed SHA-256 |
|---|---|---:|---:|---|
| `vancouver-corridor-initial-2026-10-28.osm.json.gz` | 2026-10-28T03:41:20Z | 8,478 | 1,125,785 | `336867600f94a196beb0534515eab540f332c099a3b91928a13027fd0ad18578` |
| `vancouver-corridor-expanded-2026-10-28.osm.json.gz` | 2026-10-28T03:52:36Z | 13,875 | 1,892,856 | `c936f42754a3882c835935dba7b954bbf4c51ff2356e4bfec4407a022dae2895` |

Normalized JSON sizes are reproducible fixture sizes, not measured original wire bytes. Data © OpenStreetMap contributors, ODbL under the links above. Tests replay locally with no service requests or personal device location. These historical snapshots do not establish current access, routing completeness or safe riding conditions.

## Default-circle diagnostic snapshot

`vancouver-default-corridor-2026-10-28.osm.json.gz` is the complete initial response for the untouched default 10 km-circumference circle centered at 49.299, −123.133, radius 1,591.549 m. It covers a buffered ring, not a disk; no expanded response was acquired. OSM timestamp 2026-10-28T05:06:00Z; 11,581 elements, 1,412,608 normalized uncompressed bytes, SHA-256 `a485e109eaf125d13fcfee0244f79794d27464d42443746f087df34a5287dfe0`. The initial start component lacks roads in five angular sectors, so the solver requests bounded expansion; this snapshot does not establish that expansion could never find a route. It is historical public OSM data, not user location. Data © OpenStreetMap contributors, ODbL under the links above. See generation-center-diagnosis.md.

### Completed bounded default expansion

`vancouver-default-expanded-2026-10-28.osm.json.gz` is the subsequent complete **ring plus two patches** response, replacing the initial snapshot rather than merging into it. OSM timestamp 2026-10-28T05:14:05Z; 14,073 elements, 1,674,975 normalized JSON bytes, SHA-256 `bebaaf9120aa73424a392f226c45fb1aafe6de50d7193ea29516f2a4831da3b5`. This does not cover a complete disk. Together the two default snapshots reproduce the normal bounded planner's no-loop result; expansion connects western roads but leaves three angular sectors empty in the start component. Data © OpenStreetMap contributors, ODbL under the links above. See the completed-default follow-up in `docs/generation-center-diagnosis.md`.
