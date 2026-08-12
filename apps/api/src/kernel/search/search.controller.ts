import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiQuery({ name: 'q', required: true })
  async global(@Query('q') q: string) {
    if (!q || q.trim().length < 2) return { data: [] };
    const hits = await this.search.search(q);
    return { data: hits };
  }
}
