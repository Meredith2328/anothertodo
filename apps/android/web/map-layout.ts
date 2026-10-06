import ELK, { type ElkNode } from 'elkjs/lib/elk-api.js';
import type { MapEdge } from '../../../src/core/dependency-map.js';

export type MapGeometry = { width: number; height: number; nodes: { id: string; x: number; y: number }[]; edges: { from: string; to: string; points: { x: number; y: number }[] }[] };
export const startLayout = (ids: string[], edges: MapEdge[]): { result: Promise<MapGeometry>; terminate: () => void } => {
  const aliases = new Map(ids.map((id, index) => [id, `node-${index}`]));
  const originals = new Map([...aliases].map(([id, alias]) => [alias, id]));
  const transport = new Worker(new URL('./elk-worker.min.js', import.meta.url));
  const failure = new Promise<never>((_resolve, reject) => {
    transport.onerror = event => { event.preventDefault(); reject(new Error(event.message)); };
    transport.onmessageerror = () => reject(new Error('地图布局数据无法读取'));
  });
  const engine = new ELK({ algorithms: ['layered'], workerFactory: () => transport });
  const result = Promise.race([engine.layout<ElkNode>({ id: 'route', layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': 'UP', 'elk.edgeRouting': 'POLYLINE',
    'elk.padding': '[top=32,left=40,bottom=32,right=40]', 'elk.spacing.nodeNode': '32', 'elk.layered.spacing.nodeNodeBetweenLayers': '54',
  }, children: ids.map(id => ({ id: aliases.get(id)!, width: 144, height: 136 })), edges: edges.map((edge, index) => ({ id: `edge-${index}`, sources: [aliases.get(edge.from)!], targets: [aliases.get(edge.to)!] })) }), failure]).then(graph => ({
    width: graph.width!, height: graph.height!, nodes: graph.children!.map(node => ({ id: originals.get(node.id)!, x: node.x! + node.width! / 2, y: node.y! + node.height! / 2 })),
    edges: graph.edges!.map(edge => {
      const section = edge.sections![0]!;
      return { from: originals.get(edge.sources[0]!)!, to: originals.get(edge.targets[0]!)!, points: [section.startPoint, ...section.bendPoints ?? [], section.endPoint] };
    }),
  }));
  return { result, terminate: () => engine.terminateWorker() };
};
