import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { InventoryCountService } from './inventory-count.service';
import { SaveCountDraftDto, StartCountDto, SubmitCountDto } from './dto/inventory-count.dto';

@Controller('inventory/counts')
export class InventoryCountController {
  constructor(private readonly counts: InventoryCountService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.inventoryCount.read)
  list() {
    return this.counts.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.inventoryCount.read)
  get(@Param('id') id: string) {
    return this.counts.get(id);
  }

  @Post('start')
  @RequirePermissions(PERMISSIONS.inventoryCount.count)
  start(@Body() dto: StartCountDto) {
    return this.counts.start(dto);
  }

  @Patch(':id/draft')
  @RequirePermissions(PERMISSIONS.inventoryCount.count)
  saveDraft(@Param('id') id: string, @Body() dto: SaveCountDraftDto) {
    return this.counts.saveDraft(id, dto);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.inventoryCount.submit)
  submit(@Param('id') id: string, @Body() dto: SubmitCountDto) {
    return this.counts.submit(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.inventoryCount.count)
  cancel(@Param('id') id: string) {
    return this.counts.cancel(id);
  }
}
