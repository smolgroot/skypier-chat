import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Box, useTheme } from '@mui/material';

interface NetworkGraphProps {
  localPeerId: string;
  connectedPeers: string[];
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  isLocal: boolean;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string;
  target: string;
}

export function NetworkGraph({ localPeerId, connectedPeers }: NetworkGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    if (!svgRef.current) return;

    const width = svgRef.current.clientWidth || 600;
    const height = 400;

    // Clear previous graph
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', [0, 0, width, height])
      .style('width', '100%')
      .style('height', `${height}px`);

    // Prepare data
    const nodes: Node[] = [
      { id: localPeerId, isLocal: true, x: width / 2, y: height / 2, fx: width / 2, fy: height / 2 }
    ];

    connectedPeers.forEach(peerId => {
      nodes.push({ id: peerId, isLocal: false });
    });

    const links: Link[] = connectedPeers.map(peerId => ({
      source: localPeerId,
      target: peerId
    }));

    // Definitions for filters and gradients
    const defs = svg.append('defs');

    // Glow filter
    const filter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    
    filter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur');
    
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Simulation
    const simulation = d3.forceSimulation<Node>(nodes)
      .force('link', d3.forceLink<Node, Link>(links).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    // Links
    const link = svg.append('g')
      .attr('stroke', isDark ? 'rgba(171, 110, 255, 0.3)' : 'rgba(31, 124, 255, 0.2)')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,5')
      .selectAll('line')
      .data(links)
      .join('line');

    // Nodes
    const node = svg.append('g')
      .selectAll<SVGGElement, Node>('g')
      .data(nodes)
      .join('g')
      .call(d3.drag<SVGGElement, Node>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    // Node circles (Glass style)
    node.append('circle')
      .attr('r', d => d.isLocal ? 20 : 15)
      .attr('fill', d => d.isLocal 
        ? (isDark ? 'rgba(142, 45, 226, 0.6)' : 'rgba(31, 124, 255, 0.6)') 
        : (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)'))
      .attr('stroke', d => d.isLocal 
        ? (isDark ? '#ab6eff' : '#1f7cff') 
        : (isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)'))
      .attr('stroke-width', 2)
      .style('backdrop-filter', 'blur(4px)')
      .style('filter', d => d.isLocal ? 'url(#glow)' : 'none');

    // Node labels
    node.append('text')
      .text(d => d.isLocal ? 'ME' : `...${d.id.slice(-6)}`)
      .attr('dy', 35)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.palette.text.primary)
      .style('font-size', '10px')
      .style('font-weight', 'bold')
      .style('pointer-events', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as any).x)
        .attr('y1', d => (d.source as any).y)
        .attr('x2', d => (d.target as any).x)
        .attr('y2', d => (d.target as any).y);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any, d: Node) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: Node) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: Node) {
      if (!event.active) simulation.alphaTarget(0);
      if (!d.isLocal) {
        d.fx = null;
        d.fy = null;
      }
    }

    return () => { simulation.stop(); };
  }, [localPeerId, connectedPeers, isDark, theme.palette.text.primary]);

  return (
    <Box 
      sx={{ 
        width: '100%', 
        height: 400, 
        position: 'relative',
        borderRadius: 4,
        overflow: 'hidden',
        bgcolor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)',
        border: isDark ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(0,0,0,0.05)'
      }}
    >
      <svg ref={svgRef} style={{ cursor: 'grab' }} />
    </Box>
  );
}
