import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const PRICE_ID = process.env.STRIPE_PRICE_ID!;

type CheckoutBody = {
  email?: string;
};

export async function POST(req: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: "Missing STRIPE_SECRET_KEY" },
        { status: 500 }
      );
    }

    if (!PRICE_ID) {
      return NextResponse.json(
        { error: "Missing STRIPE_PRICE_ID" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as CheckoutBody;
    const email = body.email?.trim().toLowerCase();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${SITE_URL}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/build/portfolio?canceled=true`,
      customer_email: email || undefined,
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("checkout route error:", error);

    return NextResponse.json(
      { error: "Failed to create checkout session." },
      { status: 500 }
    );
  }
}