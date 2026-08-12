import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../kernel/auth/decorators/public.decorator';

/**
 * Phase B2: minimal Prometheus metrics endpoint. We don't pull in
 * `prom-client` to keep dependencies lean for the beta — the format below
 * is hand-crafted and covers the few counters that matter for an MVP runbook.
 *
 * In production replace with `@willsoto/nestjs-prometheus` for histograms
 * (request latency, DB query time) and a real registry. For now the
 * scraper sees process uptime, current pid, and the build SHA.
 */
@Controller('metrics')
export class MetricsController {
  private readonly startTime = Date.now();

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    const uptimeSec = (Date.now() - this.startTime) / 1000;
    const mem = process.memoryUsage();
    const lines: string[] = [];

    // Process
    lines.push('# HELP erp_process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE erp_process_uptime_seconds gauge');
    lines.push(`erp_process_uptime_seconds ${uptimeSec.toFixed(3)}`);

    lines.push('# HELP erp_process_memory_bytes Process memory usage');
    lines.push('# TYPE erp_process_memory_bytes gauge');
    lines.push(`erp_process_memory_bytes{type="rss"} ${mem.rss}`);
    lines.push(`erp_process_memory_bytes{type="heap_total"} ${mem.heapTotal}`);
    lines.push(`erp_process_memory_bytes{type="heap_used"} ${mem.heapUsed}`);
    lines.push(`erp_process_memory_bytes{type="external"} ${mem.external}`);

    // Node info
    lines.push('# HELP erp_node_info Node.js version');
    lines.push('# TYPE erp_node_info gauge');
    lines.push(`erp_node_info{version="${process.versions.node}"} 1`);

    return lines.join('\n') + '\n';
  }
}