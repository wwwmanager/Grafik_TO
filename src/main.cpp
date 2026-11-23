#include <QApplication>
#include <QMainWindow>
#include <QLabel>
#include <QVBoxLayout>
#include <QWidget>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    app.setApplicationName("Grafik_TO");
    app.setApplicationVersion("0.1.0");
    app.setOrganizationName("Grafik_TO");

    QMainWindow window;
    window.setWindowTitle("Grafik_TO");
    window.resize(800, 600);

    QWidget *central = new QWidget(&window);
    QVBoxLayout *layout = new QVBoxLayout(central);
    QLabel *label = new QLabel("Grafik_TO — готово к разработке", central);
    label->setAlignment(Qt::AlignCenter);
    label->setStyleSheet("font-size: 18px; color: #333;");
    layout->addWidget(label);
    window.setCentralWidget(central);

    window.show();
    return app.exec();
}