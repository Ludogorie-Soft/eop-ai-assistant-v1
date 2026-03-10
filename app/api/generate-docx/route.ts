/**
 * DOCX generation and download API route
 */

import { NextRequest, NextResponse } from "next/server";
import { generateTenderDocx, type SmrResultForDocx } from "@/lib/docxGenerator";
import {
  extractLocation,
  fetchStreetViewImage,
  STREET_VIEW_IMAGE_WIDTH,
  STREET_VIEW_IMAGE_HEIGHT,
} from "@/lib/satelliteImage";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { introductionText, rawText, smrResults, teamOrganizationText } = body as {
      introductionText?: string;
      rawText?: string;
      smrResults?: SmrResultForDocx[];
      teamOrganizationText?: string;
    };
    const hasIntroduction =
      typeof introductionText === "string" &&
      introductionText.trim().length > 0;
    const hasSmr = Array.isArray(smrResults) && smrResults.length > 0;
    if (!hasIntroduction && !hasSmr) {
      return NextResponse.json(
        {
          error: "Нужен е поне увод или генерирани текстове за КСС за експорт.",
        },
        { status: 400 },
      );
    }

    const smr: SmrResultForDocx[] | undefined = Array.isArray(smrResults)
      ? smrResults
      : undefined;

    let satelliteImage:
      | { data: Buffer; width: number; height: number }
      | undefined;
    const hasApiKey = Boolean(process.env.GOOGLE_MAPS_API_KEY);
    console.log("[generate-docx] GOOGLE_MAPS_API_KEY present:", hasApiKey);

    if (hasIntroduction && hasApiKey) {
      const location = extractLocation(introductionText!, rawText);
      console.log("[generate-docx] Extracted location:", location);
      if (location) {
        const imgData = await fetchStreetViewImage(location);
        console.log(
          "[generate-docx] Street View image fetched:",
          imgData ? `${imgData.length} bytes` : "null",
        );
        if (imgData) {
          satelliteImage = {
            data: imgData,
            width: STREET_VIEW_IMAGE_WIDTH,
            height: STREET_VIEW_IMAGE_HEIGHT,
          };
        }
      }
    }

    const { buffer, filename } = await generateTenderDocx(
      hasIntroduction ? introductionText : undefined,
      typeof rawText === "string" ? rawText : undefined,
      smr,
      satelliteImage,
      typeof teamOrganizationText === "string" ? teamOrganizationText : undefined,
    );

    const asciiFallback = "tender.docx";
    const encodedFilename = encodeURIComponent(filename);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate DOCX";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
