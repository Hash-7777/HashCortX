"""A shopping cart that keeps its lines in the order they were added."""


class Cart:
    def __init__(self, currency="EUR"):
        self.currency = currency
        self.lines = []

    def add_item(self, name, price, quantity=1):
        """Add a line, or add to the quantity of a line with the same name and price."""
        if quantity <= 0:
            raise ValueError("quantity must be at least 1")
        if price < 0:
            raise ValueError("price cannot be negative")
        for line in self.lines:
            if line["name"] == name and line["price"] == price:
                line["quantity"] += quantity
                return line
        line = {"name": name, "price": price, "quantity": quantity}
        self.lines.append(line)
        return line

    def total(self):
        """The price of everything in the cart."""
        return round(sum(l["price"] * l["quantity"] for l in self.lines), 2)

    def count(self):
        """How many items the cart holds, counting each unit."""
        return sum(l["quantity"] for l in self.lines)
