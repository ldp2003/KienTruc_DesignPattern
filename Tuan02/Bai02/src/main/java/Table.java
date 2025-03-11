import java.util.ArrayList;
import java.util.List;

public class Table implements MenuComponent {
    private String tableNumber;
    private List<MenuComponent> items;

    public Table(String tableNumber) {
        this.tableNumber = tableNumber;
        this.items = new ArrayList<>();
    }

    public void addItem(MenuComponent item) {
        items.add(item);
    }

    public void removeItem(MenuComponent item) {
        items.remove(item);
    }

    @Override
    public double getPrice() {
        double total = 0;
        for (MenuComponent item : items) {
            total += item.getPrice();
        }
        return total;
    }

    @Override
    public String getName() {
        return "Table " + tableNumber;
    }

    public List<MenuComponent> getItems() {
        return items;
    }
}