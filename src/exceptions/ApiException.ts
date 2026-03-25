interface ApiErrorEntry {
  code?: string;
  message: string;
}

interface ApiErrorMessages {
  [type: string]: ApiErrorEntry[];
}

interface ApiErrorBody {
  errorMessages?: ApiErrorMessages;
}

/**
 * ApiException - thrown when the Swedbank API returns an error response
 */
export class ApiException extends Error {
  public readonly code: number;
  public readonly errorMessages: string[];
  public readonly responseBody: string;

  constructor(responseBody: string, code: number = 0) {
    let message = responseBody;
    const errorMessages: string[] = [];

    try {
      const result = JSON.parse(responseBody) as ApiErrorBody;

      if (result.errorMessages) {
        for (const [type, data] of Object.entries(result.errorMessages)) {
          data.forEach((error, ii) => {
            const index = ii + 1;
            let temp = `${type} (${index}): `;

            if (error.code) {
              temp += `${error.code} - `;
            }

            temp += error.message;
            errorMessages.push(temp);
          });
        }

        if (errorMessages.length > 0) {
          message = errorMessages.join("; ");
        }
      }
    } catch {
      // Not valid JSON - use raw body as message
    }

    super(message);
    this.name = "ApiException";
    this.code = code;
    this.errorMessages = errorMessages;
    this.responseBody = responseBody;
  }
}
