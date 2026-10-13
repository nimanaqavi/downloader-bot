'#Language "WWB-COM"
Option Explicit

Sub Main
    ' 1. Set Units
    With Units
        .Geometry "mm"
        .Frequency "GHz"
        .Time "ns"
    End With

    ' 2. Define Parameters
    StoreParameter "a", "22.86"
    StoreParameter "b", "10.16"
    StoreParameter "length", "50"
    StoreParameter "t_slab", "3"
    StoreParameter "eps_r", "2.2"

    ' 3. Set Frequency Range (Center 9 GHz)
    Solver.FrequencyRange "7.0", "11.0"

    ' 4. Define Material (Dielectric)
    With Material
        .Reset
        .Name "Dielectric_Material"
        .Epsilon "eps_r"
        .Mue "1.0"
        .Type "Normal"
        .Colour "0.2", "0.6", "0.9"
        .Create
    End With

    ' 5. Create Air Waveguide body (Vacuum)
    Solid.CreateBrick "Air_Guide", "Guide", "Vacuum", "-a/2", "a/2", "-b/2", "b/2", "0", "length"

    ' 6. Create Central Dielectric Slab
    Solid.CreateBrick "Slab", "Guide", "Dielectric_Material", "-t_slab/2", "t_slab/2", "-b/2", "b/2", "0", "length"

    ' 7. Insert Slab into Guide (Boolean Insert)
    Solid.Insert "Guide:Air_Guide", "Guide:Slab"

    ' 8. Set Boundary Conditions (PEC walls, open Z)
    With Boundary
        .Xmin "electric"
        .Xmax "electric"
        .Ymin "electric"
        .Ymax "electric"
        .Zmin "expanded open"
        .Zmax "expanded open"
    End With

    ' 9. Add Waveguide Ports
    With Port
        .Reset
        .PortNumber "1"
        .NumberOfModes "2"
        .Orientation "zmin"
        .PortOnBound "True"
        .Xrange "-a/2", "a/2"
        .Yrange "-b/2", "b/2"
        .Zrange "0", "0"
        .Create
    End With

    With Port
        .Reset
        .PortNumber "2"
        .NumberOfModes "2"
        .Orientation "zmax"
        .PortOnBound "True"
        .Xrange "-a/2", "a/2"
        .Yrange "-b/2", "b/2"
        .Zrange "length", "length"
        .Create
    End With

    Rebuild
End Sub
