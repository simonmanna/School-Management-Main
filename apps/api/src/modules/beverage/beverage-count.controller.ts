import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { BeverageCountService } from './beverage-count.service';
import {
  SaveBottleCountDraftDto,
  StartBottleCountDto,
  SubmitBottleCountDto,
} from './dto/bottle-count.dto';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

@RequiresModule('beverage')
@Controller('beverage/counts')
export class BeverageCountController {
  constructor(private readonly counts: BeverageCountService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.beverage.read)
  list() {
    return this.counts.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.beverage.read)
  get(@Param('id') id: string) {
    return this.counts.get(id);
  }

  @Post('start')
  @RequirePermissions(PERMISSIONS.beverage.count)
  start(@Body() dto: StartBottleCountDto) {
    return this.counts.start(dto);
  }

  @Patch(':id/draft')
  @RequirePermissions(PERMISSIONS.beverage.count)
  saveDraft(@Param('id') id: string, @Body() dto: SaveBottleCountDraftDto) {
    return this.counts.saveDraft(id, dto);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.beverage.count)
  submit(@Param('id') id: string, @Body() dto: SubmitBottleCountDto) {
    return this.counts.submit(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.beverage.count)
  cancel(@Param('id') id: string) {
    return this.counts.cancel(id);
  }
}
