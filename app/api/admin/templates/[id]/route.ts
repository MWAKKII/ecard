import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";
import { deleteImageObject } from "@/lib/object-storage";
import { logError } from "@/lib/logger";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delete a card design (admin only).
 *
 * `Event.cardTemplateId` is declared `onDelete: SetNull`, so events using the
 * design simply lose the assignment and must pick another design before new
 * cards can be rendered. Personalized PNGs are a regenerable cache on the
 * guest row, so deleting a design only requires cleaning up its uploaded file.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    const template = await prisma.cardTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        imageUrl: true,
        _count: { select: { events: true } },
      },
    });
    if (!template) return NextResponse.json({ error: "Design not found" }, { status: 404 });

    await prisma.cardTemplate.delete({ where: { id } });

    // The database row is the source of truth. Remove the private object after
    // the row is gone; a storage outage must not block design deletion.
    try {
      await deleteImageObject(template.imageUrl);
    } catch (storageError) {
      logError("Template storage cleanup failed", storageError, {
        templateId: id,
        adminId: admin.userId,
      });
    }

    await recordAudit({
      actorId: admin.userId,
      action: "template.deleted",
      entityType: "card_template",
      entityId: id,
      metadata: {
        title: template.title,
        assignedEvents: template._count.events,
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({
      success: true,
      title: template.title,
      assignedEvents: template._count.events,
    });
  } catch (error) {
    console.error("Delete template error:", error);
    return NextResponse.json({ error: "Unable to delete the design" }, { status: 500 });
  }
}
