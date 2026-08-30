import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { IncomeHeadsService } from './income-heads.service';
import { CreateIncomeHeadDto, UpdateIncomeHeadDto } from './dto/income.dto';

@Controller('income-heads')
export class IncomeHeadsController {
  constructor(private readonly heads: IncomeHeadsService) {}

  @Get()
  list() {
    return this.heads.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.heads.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateIncomeHeadDto) {
    return this.heads.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIncomeHeadDto) {
    return this.heads.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.heads.remove(id);
  }
}
