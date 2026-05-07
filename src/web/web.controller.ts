import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';

@Controller()
export class WebController {
  @Public()
  @Get()
  index(@Res() response: Response): void {
    response.redirect('/assets/index.html');
  }

  @Public()
  @Get('index.html')
  indexHtml(@Res() response: Response): void {
    response.redirect('/assets/index.html');
  }
}
