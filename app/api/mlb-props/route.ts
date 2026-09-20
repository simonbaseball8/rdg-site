import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SPEC_URL = "https://oddize.com/api/v1/openapi.json";

export async function GET() {
  try {
    const response = await fetch(SPEC_URL, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          status: response.status,
          error: text.slice(0, 2000),
        },
        { status: response.status }
      );
    }

    let spec: any;

    try {
      spec = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Oddize OpenAPI spec was not valid JSON.",
          raw: text.slice(0, 2000),
        },
        { status: 500 }
      );
    }

    const paths = spec?.paths ?? {};

    const propPaths = Object.entries(paths)
      .filter(([path]) =>
        path.toLowerCase().includes("prop")
      )
      .map(([path, details]: [string, any]) => {
        const get = details?.get;

        const parameters =
          get?.parameters?.map((parameter: any) => ({
            name: parameter?.name,
            in: parameter?.in,
            required: parameter?.required,
            description: parameter?.description,
            schema: parameter?.schema,
          })) ?? [];

        return {
          path,
          summary: get?.summary ?? null,
          description: get?.description ?? null,
          parameters,
        };
      });

    const propTypeInfo: any[] = [];

    for (const item of propPaths) {
      for (const parameter of item.parameters) {
        if (
          String(parameter?.name)
            .toLowerCase()
            .includes("prop")
        ) {
          propTypeInfo.push({
            path: item.path,
            parameter,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,

      purpose:
        "Inspect Oddize OpenAPI specification for exact player prop_type values.",

      prop_paths_found: propPaths.length,

      prop_type_parameters: propTypeInfo,

      prop_paths: propPaths,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown Oddize OpenAPI error",
      },
      { status: 500 }
    );
  }
}
