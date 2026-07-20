import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception instanceof HttpException 
      ? exception.getResponse() 
      : null;

    let errorCode = 'INTERNAL_SERVER_ERROR';
    let errorMessage = exception instanceof Error ? exception.message : 'An unexpected error occurred';

    if (exceptionResponse && typeof exceptionResponse === 'object') {
      const resObj = exceptionResponse as any;
      if (resObj.error?.code) {
        errorCode = resObj.error.code;
        errorMessage = resObj.error.message;
      } else if (resObj.message) {
        // Standard ValidationPipe errors
        errorCode = 'VALIDATION_ERROR';
        errorMessage = Array.isArray(resObj.message) ? resObj.message.join(', ') : resObj.message;
      }
    }

    response.status(status).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
      },
    });
  }
}
