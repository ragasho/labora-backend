// Helper: parse cart quantities from Redis (strings) to numbers
export const parseCart = (cartRaw: Record<string, string>): Record<string, number> => {
    const cart: Record<string, number> = {};
    for (const [key, value] of Object.entries(cartRaw)) {
        cart[key] = parseInt(value, 10);
    }
    return cart;
};